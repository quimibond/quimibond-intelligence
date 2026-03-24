import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

interface EnrichCompanyRequest {
  company_id: string;
}

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

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Se requiere ANTHROPIC_API_KEY. Configurala en Vercel → Settings → Environment Variables." },
        { status: 503 }
      );
    }

    const body: EnrichCompanyRequest = await request.json();
    const companyId = body.company_id;

    if (!companyId) {
      return NextResponse.json({ error: "company_id es requerido." }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Fetch company from companies table
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
    }

    // Fetch contacts via company_id FK
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, email, contact_type, risk_level, sentiment_score, role, entity_id")
      .eq("company_id", company.id)
      .limit(20);

    // Fetch recent emails via contacts' emails (emails table has no company_id)
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

    // Fetch facts via entity_id (facts table has no company_id)
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
      `Company: ${company.name}`,
      `Industry: ${company.industry ?? "Unknown"}`,
      `Is customer: ${company.is_customer}`,
      `Is supplier: ${company.is_supplier}`,
      `Lifetime value: ${company.lifetime_value ?? "Unknown"}`,
      `Country: ${company.country ?? "Unknown"}`,
      `City: ${company.city ?? "Unknown"}`,
    ];

    if (company.odoo_context) {
      parts.push(`Odoo context: ${JSON.stringify(company.odoo_context)}`);
    }

    if (contacts && contacts.length > 0) {
      parts.push(`\n--- Contacts (${contacts.length}) ---`);
      for (const c of contacts) {
        parts.push(`${c.name ?? "?"} <${c.email ?? "?"}> - Role: ${c.role ?? "?"}, Risk: ${c.risk_level ?? "?"}, Sentiment: ${c.sentiment_score ?? "N/A"}`);
      }
    }

    if (emails && emails.length > 0) {
      parts.push(`\n--- Recent Emails (${emails.length}) ---`);
      for (const e of emails) {
        parts.push(`${e.email_date ?? "?"} | ${e.sender ?? "?"} → ${e.recipient ?? "?"}\n  ${e.subject ?? "(no subject)"}\n  ${e.snippet ?? ""}`);
      }
    }

    if (facts && facts.length > 0) {
      parts.push("\n--- Known Facts ---");
      for (const f of facts) {
        parts.push(`[${f.fact_type ?? "general"}] ${f.fact_text} (confidence: ${f.confidence})`);
      }
    }

    // Call Claude
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: "You are a business intelligence analyst for Quimibond, a Mexican textile manufacturer. Based on email communications and known facts, generate a detailed company profile. Respond ONLY with valid JSON.",
        messages: [{
          role: "user",
          content: `Analyze the following company data and generate a profile.\n\n${parts.join("\n")}\n\nReturn JSON with: description, business_type, industry, relationship_type, relationship_summary, key_products (array), risk_signals (array), opportunity_signals (array), strategic_notes`,
        }],
      }),
    });

    if (!claudeResponse.ok) {
      return NextResponse.json({ error: "Error al llamar a Claude API." }, { status: 502 });
    }

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content?.[0]?.text ?? "";

    let profile: ClaudeCompanyProfile;
    try {
      profile = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        profile = JSON.parse(jsonMatch[1].trim());
      } else {
        return NextResponse.json({ error: "No se pudo interpretar la respuesta de Claude." }, { status: 502 });
      }
    }

    // Update COMPANIES table (not entities)
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
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}
