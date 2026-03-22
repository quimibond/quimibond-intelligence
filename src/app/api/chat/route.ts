import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

async function getRelevantContext(question: string): Promise<string> {
  const supabase = getSupabase();
  const parts: string[] = [];
  const q = question.toLowerCase();

  // Determine what context is most relevant based on the question
  const wantsAlerts = /alert|alerta|riesgo|problema|issue|peligro|amenaza|critico/i.test(q);
  const wantsActions = /accion|action|pendiente|tarea|mision|hacer|completar|vence/i.test(q);
  const wantsBriefings = /briefing|reporte|resumen|summary|diario|semanal/i.test(q);
  const wantsContacts = /contacto|cliente|persona|quien|empresa|company|perfil|relacion/i.test(q);
  const wantsFacts = /hecho|fact|dato|informacion|sab(e|emos)|conoce/i.test(q);
  const wantsEmails = /email|correo|mensaje|comunic|escrib/i.test(q);
  const wantsAll = !wantsAlerts && !wantsActions && !wantsBriefings && !wantsContacts && !wantsFacts && !wantsEmails;

  // Extract potential contact name from question
  const contactNameMatch = q.match(/(?:sobre|de|con|para|acerca de|respecto a)\s+([a-záéíóúñ\s]+?)(?:\s*\?|$|\s+(?:y|que|como|cuando|donde))/i);
  const contactName = contactNameMatch?.[1]?.trim();

  // Build context in parallel based on relevance
  const queries: Promise<void>[] = [];

  // Always include high-level stats
  queries.push(
    (async () => {
      const [emailCount, alertCount, actionCount, contactCount] = await Promise.all([
        supabase.from("emails").select("id", { count: "exact", head: true }),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
        supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("risk_level", "high"),
      ]);
      parts.push(
        `## Estado actual del sistema\n- Emails procesados: ${emailCount.count}\n- Alertas abiertas: ${alertCount.count}\n- Acciones pendientes: ${actionCount.count}\n- Contactos en alto riesgo: ${contactCount.count}`,
      );
    })(),
  );

  // Alerts
  if (wantsAlerts || wantsAll) {
    queries.push(
      (async () => {
        const { data } = await supabase
          .from("alerts")
          .select("title, description, severity, contact_name, created_at, state, alert_type")
          .order("created_at", { ascending: false })
          .limit(wantsAlerts ? 20 : 10);
        if (data?.length) {
          parts.push(
            "## Alertas recientes\n" +
            data.map((a) => `- [${a.severity}/${a.state}] ${a.title} — ${a.contact_name || "N/A"} (${a.alert_type}) — ${a.description || ""}`).join("\n"),
          );
        }
      })(),
    );
  }

  // Actions
  if (wantsActions || wantsAll) {
    queries.push(
      (async () => {
        const { data } = await supabase
          .from("action_items")
          .select("description, contact_name, priority, due_date, state, assignee_email, action_type")
          .order("due_date", { ascending: true })
          .limit(wantsActions ? 20 : 10);
        if (data?.length) {
          const now = new Date();
          parts.push(
            "## Acciones/Misiones\n" +
            data.map((a) => {
              const overdue = a.due_date && a.state === "pending" && new Date(a.due_date) < now;
              return `- [${a.priority}/${a.state}${overdue ? "/VENCIDA" : ""}] ${a.description} — ${a.contact_name || "N/A"} — vence: ${a.due_date || "sin fecha"} — asignado: ${a.assignee_email || "sin asignar"}`;
            }).join("\n"),
          );
        }
      })(),
    );
  }

  // Briefings
  if (wantsBriefings || wantsAll) {
    queries.push(
      (async () => {
        const { data } = await supabase
          .from("briefings")
          .select("briefing_type, summary, created_at, period_start, period_end")
          .order("created_at", { ascending: false })
          .limit(wantsBriefings ? 5 : 3);
        if (data?.length) {
          parts.push(
            "## Briefings/Reportes recientes\n" +
            data.map((b) => `- [${b.briefing_type}] (${b.period_start} a ${b.period_end})\n  ${b.summary?.slice(0, 400) || "sin resumen"}`).join("\n"),
          );
        }
      })(),
    );
  }

  // Contacts - enhanced with profiles and patterns
  if (wantsContacts || wantsAll) {
    queries.push(
      (async () => {
        let query = supabase
          .from("contacts")
          .select("name, email, company, risk_level, sentiment_score, relationship_score, total_emails, last_interaction, contact_type");

        if (contactName) {
          query = query.ilike("name", `%${contactName}%`);
        } else {
          query = query.order("risk_level", { ascending: false });
        }

        const { data } = await query.limit(wantsContacts ? 15 : 10);
        if (data?.length) {
          parts.push(
            "## Contactos\n" +
            data.map((c) => {
              const health = Math.round(((( c.sentiment_score ?? 0) + 1) / 2) * 50 + ((c.relationship_score ?? 50) / 100) * 50);
              return `- ${c.name} (${c.company || c.email}) — riesgo: ${c.risk_level} — salud: ${health}% — sentimiento: ${c.sentiment_score?.toFixed(2) ?? "N/A"} — emails: ${c.total_emails} — tipo: ${c.contact_type || "N/A"} — ultima interaccion: ${c.last_interaction || "N/A"}`;
            }).join("\n"),
          );
        }

        // If looking for specific contact, also get their profile
        if (contactName && data?.length) {
          const contactId = data[0] && "id" in data[0] ? (data[0] as Record<string, unknown>).id : null;
          if (contactId) {
            const [profileRes, factsRes, patternsRes] = await Promise.all([
              supabase.from("person_profiles").select("*").eq("contact_id", contactId).maybeSingle(),
              supabase.from("facts").select("fact_text, confidence, fact_type").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(10),
              supabase.from("communication_patterns").select("pattern_type, description, frequency, confidence").eq("contact_id", contactId).limit(5),
            ]);

            if (profileRes.data) {
              const p = profileRes.data;
              parts.push(
                `## Perfil de ${data[0].name}\n- Rol: ${p.role || "N/A"}\n- Departamento: ${p.department || "N/A"}\n- Poder de decision: ${p.decision_power || "N/A"}\n- Estilo de comunicacion: ${p.communication_style || "N/A"}\n- Rasgos: ${p.personality_traits?.join(", ") || "N/A"}\n- Intereses: ${p.interests?.join(", ") || "N/A"}\n- Factores de decision: ${p.decision_factors?.join(", ") || "N/A"}\n- Resumen: ${p.summary || "N/A"}`,
              );
            }

            if (factsRes.data?.length) {
              parts.push(
                `## Hechos sobre ${data[0].name}\n` +
                factsRes.data.map((f) => `- [${f.fact_type}] ${f.fact_text} (confianza: ${Math.round(f.confidence * 100)}%)`).join("\n"),
              );
            }

            if (patternsRes.data?.length) {
              parts.push(
                `## Patrones de comunicacion de ${data[0].name}\n` +
                patternsRes.data.map((p) => `- [${p.pattern_type}] ${p.description} (frecuencia: ${p.frequency || "N/A"}, confianza: ${Math.round(p.confidence * 100)}%)`).join("\n"),
              );
            }
          }
        }
      })(),
    );
  }

  // Facts
  if (wantsFacts || wantsAll) {
    queries.push(
      (async () => {
        const { data } = await supabase
          .from("facts")
          .select("fact_text, confidence, source_type, fact_type, created_at")
          .gte("confidence", 0.6)
          .order("created_at", { ascending: false })
          .limit(wantsFacts ? 25 : 15);
        if (data?.length) {
          parts.push(
            "## Hechos extraidos (alta confianza)\n" +
            data.map((f) => `- [${f.fact_type}] ${f.fact_text} (confianza: ${Math.round(f.confidence * 100)}%, fuente: ${f.source_type})`).join("\n"),
          );
        }
      })(),
    );
  }

  // Entities
  queries.push(
    (async () => {
      const { data } = await supabase
        .from("entities")
        .select("name, entity_type, canonical_name")
        .order("last_seen", { ascending: false })
        .limit(20);
      if (data?.length) {
        parts.push(
          "## Entidades conocidas\n" +
          data.map((e) => `- [${e.entity_type}] ${e.canonical_name || e.name}`).join("\n"),
        );
      }
    })(),
  );

  // Recent emails if specifically asked
  if (wantsEmails) {
    queries.push(
      (async () => {
        let query = supabase
          .from("emails")
          .select("sender, recipient, subject, snippet, email_date, sender_type");

        if (contactName) {
          query = query.or(`sender.ilike.%${contactName}%,recipient.ilike.%${contactName}%`);
        }

        const { data } = await query.order("email_date", { ascending: false }).limit(15);
        if (data?.length) {
          parts.push(
            "## Emails recientes\n" +
            data.map((e) => `- [${e.sender_type}] De: ${e.sender} → ${e.recipient} — "${e.subject}" — ${e.snippet?.slice(0, 150)} — ${e.email_date}`).join("\n"),
          );
        }
      })(),
    );
  }

  // Daily summaries if asking about recent activity
  if (/hoy|ayer|reciente|ultimo|semana|dia/i.test(q)) {
    queries.push(
      (async () => {
        const { data } = await supabase
          .from("daily_summaries")
          .select("summary_date, email_count, summary, key_events")
          .order("summary_date", { ascending: false })
          .limit(3);
        if (data?.length) {
          parts.push(
            "## Resumenes diarios recientes\n" +
            data.map((d) => `- ${d.summary_date} (${d.email_count} emails): ${d.summary || "N/A"}\n  Eventos clave: ${JSON.stringify(d.key_events) || "N/A"}`).join("\n"),
          );
        }
      })(),
    );
  }

  await Promise.all(queries);

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

    const context = await getRelevantContext(question);

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
        max_tokens: 4096,
        system: `Eres el CEREBRO DE INTELIGENCIA COMERCIAL de Quimibond, empresa textil mexicana.

## Tu rol
Eres un analista de inteligencia de negocios de elite. Tu trabajo es:
1. Analizar datos de clientes, emails, alertas y acciones para dar insights accionables
2. Identificar patrones, riesgos y oportunidades que humanos podrian perder
3. Recomendar acciones concretas con prioridad y urgencia
4. Hablar como un estratega — directo, conciso, con datos que respalden cada afirmacion

## Formato de respuesta
- Usa markdown para estructurar tus respuestas
- Incluye metricas y datos especificos cuando estes disponibles
- Clasifica la urgencia: CRITICO / ALTO / MEDIO / BAJO
- Sugiere acciones concretas con responsable sugerido
- Si detectas un patron preocupante, hazlo notar explicitamente
- Si no tienes suficientes datos, di exactamente que falta

## Terminologia del sistema
- "Salud del contacto" = combinacion de sentimiento + relacion (0-100%)
- "Mision" = accion pendiente por ejecutar
- "Amenaza" = alerta activa sin resolver
- Riesgo: alto (peligro real), medio (monitorear), bajo (estable)

## Contexto actual del sistema:
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
