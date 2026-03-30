import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaudeJSON } from "@/lib/claude";
import { rateLimitResponse } from "@/lib/rate-limit";

interface ClaudeCompanyProfile {
  description: string;
  business_type: string;
  industry: string;
  relationship_type: string;
  relationship_summary: string;
  key_products: string[];
  risk_signals: string[];
  opportunity_signals: string[];
  strategic_notes: string;
}

const ENRICHMENT_COOLDOWN_DAYS = 7;

export async function POST(request: NextRequest) {
  // Rate limit: 10 enrichments per minute per client
  const limited = rateLimitResponse(request, 10, 60_000, "enrich-company");
  if (limited) return limited;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Se requiere ANTHROPIC_API_KEY." },
        { status: 503 }
      );
    }

    const { company_id: companyId } = (await request.json()) as { company_id?: string };
    if (!companyId) {
      return NextResponse.json({ error: "company_id es requerido." }, { status: 400 });
    }

    const supabase = getServiceClient();

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
    }

    // Skip if recently enriched
    if (company.enriched_at) {
      const daysSinceEnrich = (Date.now() - new Date(company.enriched_at).getTime()) / 86_400_000;
      if (daysSinceEnrich < ENRICHMENT_COOLDOWN_DAYS) {
        return NextResponse.json({
          success: true,
          skipped: true,
          message: `Empresa enriquecida hace ${Math.floor(daysSinceEnrich)} dias.`,
        });
      }
    }

    // Fetch contacts via company_id FK
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, email, contact_type, risk_level, sentiment_score, role, entity_id")
      .eq("company_id", company.id)
      .limit(20);

    // Fetch recent emails via contacts' emails
    const contactEmails = (contacts ?? []).map((c) => c.email).filter(Boolean);
    let emails: { subject: string | null; snippet: string | null; sender: string | null; recipient: string | null; email_date: string | null }[] = [];
    if (contactEmails.length > 0) {
      const emailPattern = contactEmails.map((e) => `sender.ilike.%${e}%,recipient.ilike.%${e}%`).join(",");
      const { data: emailData } = await supabase
        .from("emails")
        .select("subject, snippet, sender, recipient, email_date")
        .or(emailPattern)
        .order("email_date", { ascending: false })
        .limit(30);
      emails = emailData ?? [];
    }

    // Fetch facts via entity_id
    let facts: { fact_text: string; fact_type: string | null; confidence: number }[] = [];
    if (company.entity_id) {
      const { data: factsData } = await supabase
        .from("facts")
        .select("fact_text, fact_type, confidence")
        .eq("entity_id", company.entity_id)
        .order("confidence", { ascending: false })
        .limit(30);
      facts = factsData ?? [];
    }

    // Build context
    const parts: string[] = [
      `Empresa: ${company.name}`,
      `Industria: ${company.industry ?? "Desconocida"}`,
      `Es cliente: ${company.is_customer}`,
      `Es proveedor: ${company.is_supplier}`,
      `Valor de por vida: ${company.lifetime_value ?? "Desconocido"}`,
      `Pais: ${company.country ?? "Desconocido"}`,
      `Ciudad: ${company.city ?? "Desconocida"}`,
    ];

    if (company.odoo_context) {
      parts.push(`Contexto Odoo: ${JSON.stringify(company.odoo_context)}`);
    }

    if (contacts && contacts.length > 0) {
      parts.push(`\n--- Contactos (${contacts.length}) ---`);
      for (const c of contacts) {
        parts.push(`${c.name ?? "?"} <${c.email ?? "?"}> - Rol: ${c.role ?? "?"}, Riesgo: ${c.risk_level ?? "?"}, Sentimiento: ${c.sentiment_score ?? "N/A"}`);
      }
    }

    if (emails.length > 0) {
      parts.push(`\n--- Emails Recientes (${emails.length}) ---`);
      for (const e of emails) {
        parts.push(`${e.email_date ?? "?"} | ${e.sender ?? "?"} → ${e.recipient ?? "?"}\n  ${e.subject ?? "(sin asunto)"}\n  ${(e.snippet ?? "").slice(0, 300)}`);
      }
    }

    if (facts.length > 0) {
      parts.push("\n--- Hechos Conocidos ---");
      for (const f of facts) {
        parts.push(`[${f.fact_type ?? "general"}] ${f.fact_text} (confianza: ${f.confidence})`);
      }
    }

    // Call Claude with retry
    const { result: profile } = await callClaudeJSON<ClaudeCompanyProfile>(
      apiKey,
      {
        max_tokens: 1024,
        temperature: 0.3,
        system: "Eres un analista de inteligencia comercial de Quimibond, empresa manufacturera de textiles no tejidos en Mexico. A partir de comunicaciones por email y hechos conocidos, genera un perfil detallado de la empresa. Responde UNICAMENTE con JSON valido.",
        messages: [{
          role: "user",
          content: `Analiza los siguientes datos de la empresa y genera un perfil.\n\n${parts.join("\n")}\n\nDevuelve JSON con: description, business_type, industry, relationship_type, relationship_summary, key_products (array), risk_signals (array), opportunity_signals (array), strategic_notes`,
        }],
      },
      "enrich/company"
    );

    // Update companies table
    const { error: updateError } = await supabase
      .from("companies")
      .update({
        description: profile.description,
        business_type: profile.business_type,
        industry: profile.industry,
        relationship_type: profile.relationship_type,
        relationship_summary: profile.relationship_summary,
        key_products: profile.key_products,
        risk_signals: profile.risk_signals,
        opportunity_signals: profile.opportunity_signals,
        strategic_notes: profile.strategic_notes,
        enriched_at: new Date().toISOString(),
        enrichment_source: "claude",
      })
      .eq("id", companyId);

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return NextResponse.json({ error: "Error al guardar el perfil." }, { status: 500 });
    }

    return NextResponse.json({ success: true, profile });
  } catch (err) {
    console.error("Enrich company error:", err);
    const message = err instanceof Error ? err.message : "Error interno.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
