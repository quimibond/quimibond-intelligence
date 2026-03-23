import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

interface EnrichCompanyRequest {
  entity_id: string;
}

interface ClaudeCompanyProfile {
  description: string;
  business_type: string;
  industry: string;
  relationship_type: string;
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
        {
          error:
            "Se requiere ANTHROPIC_API_KEY para el enriquecimiento de empresas. Configúrala en las variables de entorno.",
        },
        { status: 503 }
      );
    }

    const body: EnrichCompanyRequest = await request.json();
    const { entity_id } = body;

    if (!entity_id) {
      return NextResponse.json(
        { error: "El campo 'entity_id' es requerido." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Fetch entity
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .select("*")
      .eq("id", entity_id)
      .single();

    if (entityError || !entity) {
      return NextResponse.json(
        { error: "Entidad no encontrada." },
        { status: 404 }
      );
    }

    // Fetch contacts belonging to this company
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, email, contact_type, risk_level, sentiment_score")
      .ilike("company", `%${entity.name}%`)
      .limit(20);

    // Fetch recent emails from those contacts
    const contactEmails = (contacts ?? [])
      .map((c) => c.email)
      .filter(Boolean) as string[];

    let emails: Array<{
      subject: string | null;
      snippet: string | null;
      sender: string | null;
      recipient: string | null;
      email_date: string | null;
    }> = [];

    if (contactEmails.length > 0) {
      const orFilter = contactEmails
        .map((e) => `sender.ilike.%${e}%,recipient.ilike.%${e}%`)
        .join(",");
      const { data: emailData } = await supabase
        .from("emails")
        .select("subject, snippet, sender, recipient, email_date")
        .or(orFilter)
        .order("email_date", { ascending: false })
        .limit(30);
      emails = emailData ?? [];
    }

    // Fetch facts related to entity
    const { data: facts } = await supabase
      .from("facts")
      .select("fact_text, fact_type, confidence")
      .in(
        "contact_id",
        (contacts ?? []).map((c) => c.id)
      )
      .order("confidence", { ascending: false })
      .limit(30);

    // Build context
    const contextParts: string[] = [
      `Company: ${entity.name}`,
      `Entity type: ${entity.entity_type}`,
      `Canonical name: ${entity.canonical_name ?? entity.name}`,
      `Existing attributes: ${JSON.stringify(entity.attributes ?? {})}`,
      `Last seen: ${entity.last_seen ?? "Unknown"}`,
    ];

    if (contacts && contacts.length > 0) {
      contextParts.push(`\n--- Known Contacts (${contacts.length}) ---`);
      for (const c of contacts) {
        contextParts.push(
          `${c.name ?? "?"} <${c.email ?? "?"}> - Type: ${c.contact_type ?? "?"}, Risk: ${c.risk_level ?? "?"}, Sentiment: ${c.sentiment_score ?? "N/A"}`
        );
      }
    }

    if (emails.length > 0) {
      contextParts.push(`\n--- Recent Emails (${emails.length}) ---`);
      for (const email of emails) {
        contextParts.push(
          `Date: ${email.email_date ?? "?"} | From: ${email.sender ?? "?"} | To: ${email.recipient ?? "?"}\nSubject: ${email.subject ?? "(no subject)"}\n${email.snippet ?? "(no snippet)"}\n`
        );
      }
    }

    if (facts && facts.length > 0) {
      contextParts.push("\n--- Known Facts ---");
      for (const fact of facts) {
        contextParts.push(
          `[${fact.fact_type ?? "general"}] ${fact.fact_text} (confidence: ${fact.confidence})`
        );
      }
    }

    const contextString = contextParts.join("\n");

    // Call Claude API
    const claudeResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system:
            "You are a business intelligence analyst for Quimibond, a Mexican textile manufacturer. Based on email communications and known facts, generate a detailed company profile. Respond ONLY with valid JSON, no markdown or extra text.",
          messages: [
            {
              role: "user",
              content: `Analyze the following company data and generate a company profile.\n\n${contextString}\n\nReturn a JSON object with these fields:\n- description (string): brief company description\n- business_type (string): e.g., "Proveedor", "Cliente", "Distribuidor"\n- industry (string): their industry\n- relationship_type (string): their relationship to Quimibond\n- key_products (string[]): products/services they deal with\n- risk_signals (string[]): any risk indicators observed\n- opportunity_signals (string[]): any opportunity indicators\n- strategic_notes (string): strategic observations and recommendations`,
            },
          ],
        }),
      }
    );

    if (!claudeResponse.ok) {
      const errorBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errorBody);
      return NextResponse.json(
        { error: "Error al llamar a Claude API." },
        { status: 502 }
      );
    }

    const claudeData = await claudeResponse.json();
    const rawText =
      claudeData.content?.[0]?.text ?? claudeData.content?.[0]?.value ?? "";

    let profile: ClaudeCompanyProfile;
    try {
      profile = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        profile = JSON.parse(jsonMatch[1].trim());
      } else {
        console.error("Failed to parse Claude response:", rawText);
        return NextResponse.json(
          { error: "No se pudo interpretar la respuesta de Claude." },
          { status: 502 }
        );
      }
    }

    // Update entity attributes with enrichment data
    const enrichedAttributes = {
      ...(entity.attributes ?? {}),
      ...profile,
      enriched_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("entities")
      .update({ attributes: enrichedAttributes })
      .eq("id", entity_id);

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return NextResponse.json(
        { error: "Error al guardar el perfil de empresa." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, profile });
  } catch (err) {
    console.error("Enrich company error:", err);
    return NextResponse.json(
      { error: "Error interno al enriquecer empresa." },
      { status: 500 }
    );
  }
}
