import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

interface BatchEnrichRequest {
  type: "contacts" | "companies";
  limit?: number;
}

export async function POST(request: NextRequest) {
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

    const body: BatchEnrichRequest = await request.json();
    const { type, limit = 5 } = body;

    if (!type || !["contacts", "companies"].includes(type)) {
      return NextResponse.json(
        { error: "El campo 'type' debe ser 'contacts' o 'companies'." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    let enriched = 0;
    let errors = 0;

    if (type === "contacts") {
      // Find contacts without profile data (role is null = not enriched)
      const { data: contactsToEnrich } = await supabase
        .from("contacts")
        .select("id, name, email")
        .is("role", null)
        .order("updated_at", { ascending: false })
        .limit(limit);

      for (const contact of contactsToEnrich ?? []) {
        try {
          const origin = request.headers.get("origin") ?? request.nextUrl.origin;
          const res = await fetch(`${origin}/api/enrich/contact`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contact_id: contact.id }),
          });

          if (res.ok) {
            enriched++;
          } else {
            errors++;
            console.error(
              `Failed to enrich contact ${contact.id}:`,
              await res.text()
            );
          }
        } catch (err) {
          errors++;
          console.error(`Error enriching contact ${contact.id}:`, err);
        }
      }
    } else {
      // Find companies without enrichment
      const { data: companies } = await supabase
        .from("companies")
        .select("id, name")
        .is("enriched_at", null)
        .limit(limit);

      for (const company of companies ?? []) {
        try {
          const origin = request.headers.get("origin") ?? request.nextUrl.origin;
          const res = await fetch(`${origin}/api/enrich/company`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ company_id: company.id }),
          });

          if (res.ok) {
            enriched++;
          } else {
            errors++;
            console.error(
              `Failed to enrich company ${company.id}:`,
              await res.text()
            );
          }
        } catch (err) {
          errors++;
          console.error(`Error enriching company ${company.id}:`, err);
        }
      }
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
