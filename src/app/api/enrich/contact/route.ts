import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

interface EnrichContactRequest {
  contact_id: string;
}

interface ClaudePersonProfile {
  role: string | null;
  department: string | null;
  decision_power: "high" | "medium" | "low";
  communication_style: string | null;
  personality_traits: string[];
  interests: string[];
  decision_factors: string[];
  summary: string;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Se requiere ANTHROPIC_API_KEY para el enriquecimiento de contactos. Configúrala en las variables de entorno.",
        },
        { status: 503 }
      );
    }

    const body: EnrichContactRequest = await request.json();
    const { contact_id } = body;

    if (!contact_id) {
      return NextResponse.json(
        { error: "El campo 'contact_id' es requerido." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Fetch contact
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      return NextResponse.json(
        { error: "Contacto no encontrado." },
        { status: 404 }
      );
    }

    // Fetch recent emails involving this contact
    const contactEmail = contact.email ?? "";
    const { data: emails } = await supabase
      .from("emails")
      .select("subject, body, snippet, sender, recipient, email_date")
      .or(`sender.ilike.%${contactEmail}%,recipient.ilike.%${contactEmail}%`)
      .order("email_date", { ascending: false })
      .limit(20);

    // Fetch existing facts via entity_id (facts don't have contact_id)
    let facts: { fact_text: string; fact_type: string | null; confidence: number }[] = [];
    if (contact.entity_id) {
      const { data: factsData } = await supabase
        .from("facts")
        .select("fact_text, fact_type, confidence")
        .eq("entity_id", contact.entity_id)
        .order("confidence", { ascending: false })
        .limit(30);
      facts = factsData ?? [];
    }

    // Build context
    const contextParts: string[] = [
      `Contact: ${contact.name ?? "Unknown"} <${contactEmail}>`,
      `Company: ${contact.company ?? "Unknown"}`,
      `Contact type: ${contact.contact_type ?? "Unknown"}`,
      `Risk level: ${contact.risk_level ?? "Unknown"}`,
      `Sentiment score: ${contact.sentiment_score ?? "N/A"}`,
      `Relationship score: ${contact.relationship_score ?? "N/A"}`,
      `Total emails sent: ${contact.total_sent ?? 0}, received: ${contact.total_received ?? 0}`,
    ];

    if (contact.odoo_context) {
      contextParts.push(`Odoo context: ${JSON.stringify(contact.odoo_context)}`);
    }

    if (emails && emails.length > 0) {
      contextParts.push("\n--- Recent Emails ---");
      for (const email of emails) {
        contextParts.push(
          `Date: ${email.email_date ?? "?"} | From: ${email.sender ?? "?"} | To: ${email.recipient ?? "?"}\nSubject: ${email.subject ?? "(no subject)"}\n${email.snippet ?? email.body?.slice(0, 500) ?? "(no body)"}\n`
        );
      }
    }

    if (facts.length > 0) {
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
          model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system:
            "You are a business intelligence analyst for Quimibond, a Mexican textile manufacturer. Based on email communications and known facts, generate a detailed person profile. Respond ONLY with valid JSON, no markdown or extra text.",
          messages: [
            {
              role: "user",
              content: `Analyze the following contact data and generate a person profile.\n\n${contextString}\n\nReturn a JSON object with these fields:\n- role (string): their likely job role/title\n- department (string): their department\n- decision_power ("high" | "medium" | "low"): their influence on purchasing/business decisions\n- communication_style (string): brief description of how they communicate\n- personality_traits (string[]): 3-5 personality traits observed\n- interests (string[]): professional interests or topics they engage with\n- decision_factors (string[]): factors that influence their decisions\n- summary (string): 2-3 sentence executive summary of this person`,
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

    let profile: ClaudePersonProfile;
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

    // Write profile data directly to contacts table (same as qb19 backend)
    const { data: updated, error: updateError } = await supabase
      .from("contacts")
      .update({
        role: profile.role,
        department: profile.department,
        decision_power: profile.decision_power,
        communication_style: profile.communication_style,
        key_interests: profile.interests ?? [],
        personality_notes: profile.summary,
      })
      .eq("id", contact_id)
      .select()
      .single();

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return NextResponse.json(
        { error: "Error al guardar el perfil." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, profile: updated });
  } catch (err) {
    console.error("Enrich contact error:", err);
    return NextResponse.json(
      { error: "Error interno al enriquecer contacto." },
      { status: 500 }
    );
  }
}
