import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { z } from "zod";

const BatchEnrichSchema = z.object({
  type: z.enum(["contacts", "companies"]),
  limit: z.number().int().min(1).max(20).default(5),
});

export async function POST(request: NextRequest) {
  // Rate limit: 3 batch enrichments per 5 minutes per client
  const limited = rateLimitResponse(request, 3, 300_000, "enrich-batch");
  if (limited) return limited;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Se requiere ANTHROPIC_API_KEY para el enriquecimiento. Configúrala en las variables de entorno.",
        },
        { status: 503 }
      );
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsed = BatchEnrichSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos invalidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { type, limit } = parsed.data;

    const supabase = getServiceClient();
    let enriched = 0;
    let errors = 0;

    const origin = request.headers.get("origin") ?? request.nextUrl.origin;

    if (type === "contacts") {
      const { data: contactsToEnrich } = await supabase
        .from("contacts")
        .select("id, name, email")
        .is("role", null)
        .order("updated_at", { ascending: false })
        .limit(limit);

      const results = await Promise.allSettled(
        (contactsToEnrich ?? []).map(async (contact) => {
          const res = await fetch(`${origin}/api/enrich/contact`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contact_id: contact.id }),
          });
          if (!res.ok) {
            const text = await res.text();
            console.error(`Failed to enrich contact ${contact.id}:`, text);
            throw new Error(text);
          }
        })
      );
      enriched = results.filter((r) => r.status === "fulfilled").length;
      errors = results.filter((r) => r.status === "rejected").length;
    } else {
      const { data: companies } = await supabase
        .from("companies")
        .select("id, name")
        .is("enriched_at", null)
        .limit(limit);

      const results = await Promise.allSettled(
        (companies ?? []).map(async (company) => {
          const res = await fetch(`${origin}/api/enrich/company`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ company_id: company.id }),
          });
          if (!res.ok) {
            const text = await res.text();
            console.error(`Failed to enrich company ${company.id}:`, text);
            throw new Error(text);
          }
        })
      );
      enriched = results.filter((r) => r.status === "fulfilled").length;
      errors = results.filter((r) => r.status === "rejected").length;
    }

    return NextResponse.json({ success: errors === 0, enriched, errors });
  } catch (err) {
    console.error("Batch enrich error:", err);
    return NextResponse.json(
      { error: "Error interno en enriquecimiento por lote." },
      { status: 500 }
    );
  }
}
