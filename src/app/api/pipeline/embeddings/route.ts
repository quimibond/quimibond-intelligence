import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const BATCH_SIZE = 64;
const PAGE_SIZE = 500;
const TIME_BUDGET_MS = 100_000; // margen bajo el maxDuration de 120s

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
    const started = Date.now();
    let total = 0;
    let offset = 0;

    // Procesa páginas hasta agotar el backlog o el presupuesto de tiempo —
    // así el cron (cada 15 min) drena backlogs grandes (p.ej. los 86k del
    // gap may–ago 2026) en horas en vez de semanas, y en régimen normal la
    // primera página vacía termina el request en un solo query.
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { data: emails } = await supabase
        .from("emails")
        .select("gmail_message_id, sender, subject, body, snippet")
        .is("embedding", null)
        .order("email_date", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (!emails?.length) break;

      // Filter emails with enough content; the offset advances past the
      // short ones so they never block the queue.
      const toEmbed = emails.filter(e => {
        const content = e.body || e.snippet || "";
        return content.length > 50;
      });
      offset += emails.length - toEmbed.length;

      for (let i = 0; i < toEmbed.length && Date.now() - started < TIME_BUDGET_MS; i += BATCH_SIZE) {
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
            // Rate limit u otro error del API: dejar el resto para la
            // siguiente corrida en vez de martillar el endpoint.
            if (response.status === 429) {
              offset += batch.length;
              continue;
            }
            offset += batch.length;
            continue;
          }

          const data = await response.json();
          const embeddings = data.data?.map((d: { embedding: number[] }) => d.embedding) ?? [];

          for (let j = 0; j < batch.length && j < embeddings.length; j++) {
            await supabase
              .from("emails")
              .update({ embedding: embeddings[j] })
              .eq("gmail_message_id", batch[j].gmail_message_id);
          }

          total += batch.length;
        } catch (err) {
          console.error("[embeddings] Batch error:", err);
          offset += batch.length;
        }
      }
    }

    // Health-check observability (audit 2026-04-29): log success so
    // /api/system/health detects a fresh run.
    try {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "embeddings",
        message: `Embeddings: ${total} email vectors generated`,
        details: { embeddings: total },
      });
    } catch { /* don't let logging failure mask success */ }

    return NextResponse.json({ success: true, embeddings: total });
  } catch (err) {
    console.error("[embeddings] Error:", err);
    return NextResponse.json(
      { error: "Error generando embeddings.", detail: String(err) },
      { status: 500 }
    );
  }
}
