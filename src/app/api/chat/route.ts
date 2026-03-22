import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

async function getRelevantContext(): Promise<string> {
  const supabase = getSupabase();
  const parts: string[] = [];

  const [alertsRes, actionsRes, briefingsRes, contactsRes, factsRes, entitiesRes] = await Promise.all([
    supabase
      .from("alerts")
      .select("title, description, severity, contact_name, created_at, state")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("action_items")
      .select("description, contact_name, priority, due_date, state, assignee_email")
      .eq("state", "pending")
      .order("due_date", { ascending: true })
      .limit(10),
    supabase
      .from("briefings")
      .select("briefing_type, summary, created_at")
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("contacts")
      .select("name, email, company, risk_level, sentiment_score, relationship_score")
      .eq("risk_level", "high")
      .limit(10),
    supabase
      .from("facts")
      .select("fact_text, confidence, source_type")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("entities")
      .select("name, entity_type, canonical_name")
      .order("last_seen", { ascending: false })
      .limit(20),
  ]);

  if (alertsRes.data?.length) {
    parts.push(
      "## Alertas recientes\n" +
        alertsRes.data.map((a) => `- [${a.severity}] ${a.title} (${a.contact_name || "N/A"}) - ${a.state}`).join("\n")
    );
  }

  if (actionsRes.data?.length) {
    parts.push(
      "## Acciones pendientes\n" +
        actionsRes.data.map((a) => `- [${a.priority}] ${a.description} (${a.contact_name || "N/A"}) - vence: ${a.due_date || "sin fecha"}`).join("\n")
    );
  }

  if (briefingsRes.data?.length) {
    parts.push(
      "## Ultimos briefings\n" +
        briefingsRes.data.map((b) => `- [${b.briefing_type}] ${b.summary?.slice(0, 200) || "sin resumen"}`).join("\n")
    );
  }

  if (contactsRes.data?.length) {
    parts.push(
      "## Contactos en alto riesgo\n" +
        contactsRes.data.map((c) => `- ${c.name} (${c.company || c.email}) - sentimiento: ${c.sentiment_score ?? "N/A"}, relacion: ${c.relationship_score ?? "N/A"}`).join("\n")
    );
  }

  if (factsRes.data?.length) {
    parts.push(
      "## Hechos recientes extraidos\n" +
        factsRes.data.map((f) => `- ${f.fact_text} (confianza: ${f.confidence}, fuente: ${f.source_type})`).join("\n")
    );
  }

  if (entitiesRes.data?.length) {
    parts.push(
      "## Entidades conocidas\n" +
        entitiesRes.data.map((e) => `- [${e.entity_type}] ${e.canonical_name || e.name}`).join("\n")
    );
  }

  return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const { question, history } = await req.json();

    if (!question) {
      return NextResponse.json({ error: "Pregunta requerida" }, { status: 400 });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
    }

    const context = await getRelevantContext();

    const messages = [
      ...(history || []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: question },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: `Eres el cerebro de inteligencia comercial de Quimibond, una empresa textil mexicana.
Tu rol es responder preguntas sobre clientes, ventas, operaciones y estrategia usando los datos disponibles.
Responde siempre en espanol. Se conciso y accionable. Si no tienes datos suficientes, dilo claramente.

Contexto actual del sistema:
${context}`,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Claude API error:", err);
      return NextResponse.json({ error: "Error al consultar Claude" }, { status: 502 });
    }

    const data = await response.json();
    const answer = data.content?.[0]?.text || "No pude generar una respuesta.";

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
