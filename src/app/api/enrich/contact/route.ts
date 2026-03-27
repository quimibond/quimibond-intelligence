import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaudeJSON } from "@/lib/claude";

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

const ENRICHMENT_COOLDOWN_DAYS = 7;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Se requiere ANTHROPIC_API_KEY para el enriquecimiento de contactos." },
        { status: 503 }
      );
    }

    const { contact_id } = (await request.json()) as { contact_id?: string };
    if (!contact_id) {
      return NextResponse.json({ error: "El campo 'contact_id' es requerido." }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Fetch contact
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      return NextResponse.json({ error: "Contacto no encontrado." }, { status: 404 });
    }

    // Skip if recently enriched (role is set and updated_at is recent)
    if (contact.role && contact.updated_at) {
      const daysSinceUpdate = (Date.now() - new Date(contact.updated_at).getTime()) / 86_400_000;
      if (daysSinceUpdate < ENRICHMENT_COOLDOWN_DAYS) {
        return NextResponse.json({
          success: true,
          skipped: true,
          message: `Contacto enriquecido hace ${Math.floor(daysSinceUpdate)} dias. Proximo enriquecimiento en ${Math.ceil(ENRICHMENT_COOLDOWN_DAYS - daysSinceUpdate)} dias.`,
        });
      }
    }

    // Fetch recent emails involving this contact
    const contactEmail = contact.email ?? "";
    const { data: emails } = await supabase
      .from("emails")
      .select("subject, snippet, sender, recipient, email_date")
      .or(`sender.ilike.%${contactEmail}%,recipient.ilike.%${contactEmail}%`)
      .order("email_date", { ascending: false })
      .limit(20);

    // Fetch existing facts via entity_id
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
      `Contacto: ${contact.name ?? "Desconocido"} <${contactEmail}>`,
      `ID Empresa: ${contact.company_id ?? "Desconocido"}`,
      `Tipo: ${contact.contact_type ?? "Desconocido"}`,
      `Nivel de riesgo: ${contact.risk_level ?? "Desconocido"}`,
      `Score sentimiento: ${contact.sentiment_score ?? "N/A"}`,
      `Score relacion: ${contact.relationship_score ?? "N/A"}`,
      `Emails enviados: ${contact.total_sent ?? 0}, recibidos: ${contact.total_received ?? 0}`,
    ];

    if (contact.odoo_context) {
      contextParts.push(`Contexto Odoo: ${JSON.stringify(contact.odoo_context)}`);
    }

    if (emails && emails.length > 0) {
      contextParts.push("\n--- Emails Recientes ---");
      for (const email of emails) {
        contextParts.push(
          `Fecha: ${email.email_date ?? "?"} | De: ${email.sender ?? "?"} | Para: ${email.recipient ?? "?"}\nAsunto: ${email.subject ?? "(sin asunto)"}\n${(email.snippet ?? "").slice(0, 300)}\n`
        );
      }
    }

    if (facts.length > 0) {
      contextParts.push("\n--- Hechos Conocidos ---");
      for (const fact of facts) {
        contextParts.push(
          `[${fact.fact_type ?? "general"}] ${fact.fact_text} (confianza: ${fact.confidence})`
        );
      }
    }

    const contextString = contextParts.join("\n");

    // Call Claude with retry
    const { result: profile } = await callClaudeJSON<ClaudePersonProfile>(
      apiKey,
      {
        max_tokens: 1024,
        temperature: 0.3,
        system:
          "Eres un analista de inteligencia comercial de Quimibond, empresa manufacturera de textiles no tejidos en Mexico. A partir de comunicaciones por email y hechos conocidos, genera un perfil detallado de la persona. Responde UNICAMENTE con JSON valido, sin markdown ni texto adicional.",
        messages: [
          {
            role: "user",
            content: `Analiza los siguientes datos del contacto y genera un perfil.\n\n${contextString}\n\nDevuelve un objeto JSON con estos campos:\n- role (string): su cargo o rol probable\n- department (string): su departamento\n- decision_power ("high" | "medium" | "low"): su influencia en decisiones de compra/negocio\n- communication_style (string): breve descripcion de como se comunica\n- personality_traits (string[]): 3-5 rasgos de personalidad observados\n- interests (string[]): intereses profesionales o temas con los que se involucra\n- decision_factors (string[]): factores que influyen en sus decisiones\n- summary (string): resumen ejecutivo de 2-3 oraciones sobre esta persona`,
          },
        ],
      },
      "enrich/contact"
    );

    // Write profile to contacts table
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
      return NextResponse.json({ error: "Error al guardar el perfil." }, { status: 500 });
    }

    return NextResponse.json({ success: true, profile: updated });
  } catch (err) {
    console.error("Enrich contact error:", err);
    const message = err instanceof Error ? err.message : "Error interno al enriquecer contacto.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
