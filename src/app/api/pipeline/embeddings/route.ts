import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const BATCH_SIZE = 64;

// Vercel Crons use GET
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const voyageKey = process.env.VOYAGE_API_KEY;
    if (!voyageKey) {
      return NextResponse.json({ error: "VOYAGE_API_KEY no configurado." }, { status: 503 });
    }

    const supabase = getServiceClient();

    // Find emails without embeddings that have enough content
    const { data: emails } = await supabase
      .from("emails")
      .select("gmail_message_id, sender, subject, body, snippet")
      .is("embedding", null)
      .order("email_date", { ascending: false })
      .limit(500);

    // Filter emails with enough content
    const toEmbed = (emails ?? []).filter(e => {
      const content = e.body || e.snippet || "";
      return content.length > 50;
    });

    if (!toEmbed.length) {
      return NextResponse.json({ success: true, embeddings: 0, message: "Nada pendiente" });
    }

    let total = 0;

    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      const texts = batch.map(e =>
        `De: ${e.sender ?? ""} | Asunto: ${e.subject ?? ""} | ${(e.body || e.snippet || "").slice(0, 500)}`
      );

      try {
        const response = await fetch(VOYAGE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${voyageKey}`,
          },
          body: JSON.stringify({
            model: "voyage-3",
            input: texts.map(t => t.slice(0, 4000)),
            input_type: "document",
          }),
        });

        if (!response.ok) {
          console.error("[embeddings] Voyage API error:", response.status);
          continue;
        }

        const data = await response.json();
        const embeddings = data.data?.map((d: { embedding: number[] }) => d.embedding) ?? [];

        // Save embeddings to Supabase
        for (let j = 0; j < batch.length && j < embeddings.length; j++) {
          await supabase
            .from("emails")
            .update({ embedding: embeddings[j] })
            .eq("gmail_message_id", batch[j].gmail_message_id);
        }

        total += batch.length;
      } catch (err) {
        console.error("[embeddings] Batch error:", err);
      }
    }

    return NextResponse.json({ success: true, embeddings: total });
  } catch (err) {
    console.error("[embeddings] Error:", err);
    return NextResponse.json(
      { error: "Error generando embeddings.", detail: String(err) },
      { status: 500 }
    );
  }
}
