import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

interface ChatRequest {
  question: string;
  history?: Array<{ role: string; content: string }>;
}

interface ChatResponse {
  answer: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: ChatRequest = await request.json();
    const { question, history = [] } = body;

    // Validate input
    if (!question || question.trim() === "") {
      return NextResponse.json(
        { error: "No question provided" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 }
      );
    }

    // Determine context fetch strategy based on question keywords
    const questionLower = question.toLowerCase();
    const contextParts: string[] = [];

    // Extract base stats
    try {
      const [alertsCount, actionsCount, atRiskCount] = await Promise.all([
        supabase
          .from("alerts")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("action_items")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("risk_level", "high"),
      ]);

      contextParts.push(`## Estadísticas Base`);
      contextParts.push(`- Total de alertas: ${alertsCount.count || 0}`);
      contextParts.push(`- Acciones pendientes: ${actionsCount.count || 0}`);
      contextParts.push(`- Contactos de alto riesgo: ${atRiskCount.count || 0}`);
      contextParts.push("");
    } catch (err) {
      console.error("Error fetching base stats:", err);
    }

    // Fetch context based on keywords
    if (
      questionLower.includes("alerta") ||
      questionLower.includes("riesgo") ||
      questionLower.includes("alert")
    ) {
      try {
        const { data: alerts } = await supabase
          .from("alerts")
          .select("id, title, description, alert_type, severity, status, created_at")
          .order("created_at", { ascending: false })
          .limit(10);

        if (alerts && alerts.length > 0) {
          contextParts.push(`## Alertas Recientes`);
          alerts.forEach((alert: any) => {
            contextParts.push(
              `- [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.description}`
            );
          });
          contextParts.push("");
        }
      } catch (err) {
        console.error("Error fetching alerts:", err);
      }
    }

    if (
      questionLower.includes("accion") ||
      questionLower.includes("pendiente") ||
      questionLower.includes("tarea") ||
      questionLower.includes("action")
    ) {
      try {
        const { data: actions } = await supabase
          .from("action_items")
          .select(
            "id, title, description, action_type, priority, status, assigned_to, due_date"
          )
          .eq("status", "pending")
          .order("due_date", { ascending: true })
          .limit(10);

        if (actions && actions.length > 0) {
          contextParts.push(`## Acciones Pendientes`);
          actions.forEach((action: any) => {
            contextParts.push(
              `- [${action.priority.toUpperCase()}] ${action.title} (Vencimiento: ${action.due_date || "Sin fecha"})`
            );
          });
          contextParts.push("");
        }
      } catch (err) {
        console.error("Error fetching actions:", err);
      }
    }

    if (
      questionLower.includes("briefing") ||
      questionLower.includes("reporte") ||
      questionLower.includes("resumen") ||
      questionLower.includes("summary")
    ) {
      try {
        const { data: summaries } = await supabase
          .from("daily_summaries")
          .select("id, summary_date, total_emails, summary_text")
          .order("summary_date", { ascending: false })
          .limit(3);

        if (summaries && summaries.length > 0) {
          contextParts.push(`## Briefings Recientes`);
          summaries.forEach((summary: any) => {
            contextParts.push(`- ${summary.summary_date}: ${summary.summary_text}`);
          });
          contextParts.push("");
        }
      } catch (err) {
        console.error("Error fetching briefings:", err);
      }
    }

    if (
      questionLower.includes("contacto") ||
      questionLower.includes("cliente") ||
      questionLower.includes("persona") ||
      questionLower.includes("contact")
    ) {
      try {
        const { data: contacts } = await supabase
          .from("contacts")
          .select(
            "id, name, email, company, risk_level, sentiment_score, relationship_score"
          )
          .order("relationship_score", { ascending: false })
          .limit(10);

        if (contacts && contacts.length > 0) {
          contextParts.push(`## Contactos Principales`);
          contacts.forEach((contact: any) => {
            contextParts.push(
              `- ${contact.name} (${contact.company}) - Riesgo: ${contact.risk_level}, Sentimiento: ${(contact.sentiment_score * 100).toFixed(0)}%`
            );
          });
          contextParts.push("");
        }
      } catch (err) {
        console.error("Error fetching contacts:", err);
      }
    }

    if (
      questionLower.includes("email") ||
      questionLower.includes("correo") ||
      questionLower.includes("mail")
    ) {
      try {
        const { data: emails } = await supabase
          .from("emails")
          .select(
            "id, subject, from_email, to_email, sent_at, sentiment_score, intent"
          )
          .order("sent_at", { ascending: false })
          .limit(15);

        if (emails && emails.length > 0) {
          contextParts.push(`## Emails Recientes`);
          emails.forEach((email: any) => {
            contextParts.push(
              `- De: ${email.from_email} - Asunto: ${email.subject}`
            );
          });
          contextParts.push("");
        }
      } catch (err) {
        console.error("Error fetching emails:", err);
      }
    }

    const contextString = contextParts.join("\n");

    // Build system prompt
    const systemPrompt = `Eres el CEREBRO DE INTELIGENCIA COMERCIAL de Quimibond, empresa textil mexicana. Analizas datos de emails, alertas, acciones y contactos para dar insights accionables.

Responde en español (México). Sé directo, conciso y orientado a datos.

Clasifica urgencia: CRITICO / ALTO / MEDIO / BAJO

Sugiere acciones concretas con responsable específico cuando sea posible.

Mantén un tono profesional y ejecutivo. Los datos que ves son reales y deben tratarse con seriedad.`;

    // Build messages for Claude
    const messages: Array<{ role: string; content: string }> = [
      ...history,
      {
        role: "user",
        content: `CONTEXTO ACTUAL:\n\n${contextString}\n\nPREGUNTA:\n${question}`,
      },
    ];

    // Call Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Claude API error:", error);
      return NextResponse.json(
        { error: "Failed to get response from Claude" },
        { status: 502 }
      );
    }

    const result = await response.json();
    const answer =
      result.content[0].type === "text" ? result.content[0].text : "";

    return NextResponse.json({ answer } as ChatResponse);
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
