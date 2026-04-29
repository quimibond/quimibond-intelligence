/**
 * Daily Digest Meta-Director — synthesizes the top 3 actionable insights
 * from the 8 directors into a single executive summary, posted to the
 * /inbox as 1 high-priority insight.
 *
 * Why: directors emit 7-13 insights/day. The CEO's acted_on rate is ~12%.
 * Most of the value is in the top few; the rest is noise. This route
 * runs once daily, ranks director outputs by impact*confidence*recency,
 * picks top 3, and asks Haiku to synthesize a 150-word executive brief.
 *
 * Excludes agent_slug='data_quality' (those are monitoring metadata,
 * not CEO actions; they score artificially high due to massive
 * business_impact_estimate on aggregate data integrity issues).
 *
 * Cron: 0 14 * * *  (8am CDMX, after morning director rotation).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaude } from "@/lib/claude";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 60;

const DIGEST_AGENT_SLUG = "digest";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

type RankedInsight = {
  id: number;
  title: string;
  description: string | null;
  recommendation: string | null;
  severity: string;
  category: string;
  confidence: number;
  business_impact_estimate: number | null;
  company_id: number | null;
  company_name: string | null;
  assignee_name: string | null;
  agent_slug: string;
  hours_old: number;
};

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 503 });

  const supabase = getServiceClient();

  // Resolve digest agent id
  const { data: agent } = await supabase
    .from("ai_agents")
    .select("id")
    .eq("slug", DIGEST_AGENT_SLUG)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: `agent ${DIGEST_AGENT_SLUG} not found` }, { status: 500 });
  }
  const digestAgentId = agent.id as number;

  // Pull top 5 director-driven insights (last 36h, conf>=0.8, exclude data_quality)
  const { data: candidatesRaw, error: rankErr } = await supabase.rpc("top_actionable_insights", { p_limit: 15 });
  if (rankErr) {
    return NextResponse.json({ error: `rank failed: ${rankErr.message}` }, { status: 500 });
  }

  const candidates = (candidatesRaw as RankedInsight[] | null) ?? [];
  const directorTop = candidates
    .filter(i => i.agent_slug !== "data_quality")
    .slice(0, 3);

  if (directorTop.length === 0) {
    return NextResponse.json({
      success: true,
      message: "No director insights to digest",
      candidates_total: candidates.length,
    });
  }

  // Build Haiku prompt
  const rows = directorTop.map((i, idx) => {
    const impact = i.business_impact_estimate
      ? `$${Math.round(i.business_impact_estimate).toLocaleString("es-MX")} MXN`
      : "impacto sin cuantificar";
    return `${idx + 1}. [${i.severity.toUpperCase()}] ${i.title}
   Director: ${i.agent_slug} · Empresa: ${i.company_name ?? "-"} · Responsable: ${i.assignee_name ?? "-"} · Impacto: ${impact}
   Recomendación: ${(i.recommendation ?? "").slice(0, 280)}`;
  }).join("\n\n");

  const n = directorTop.length;
  const userPrompt = `Aquí están los ${n} insights más urgentes del día (ranqueados por impacto × confianza × recencia):

${rows}

Genera el digest. Responde SOLO con JSON:
{
  "title": "Top ${n} hoy: <${n} verbos imperativos separados por espacio>",
  "body": "Párrafo de máximo 150 palabras. Si los ${n} comparten señal (mismo cliente, mismo riesgo, misma área), conéctalos en 1 narrativa. Si no, lista ${n} acciones imperativas con plazo y responsable. Cita IDs de factura/empresa/producto cuando aparezcan en la evidencia. NO inventes."
}`;

  const systemPrompt = `Eres el sintetizador diario del CEO de Quimibond. Tu único trabajo es producir 1 párrafo ejecutivo (≤150 palabras) que conecte los 3 insights de mayor impacto del día. Reglas:
- NO inventes datos. Solo combina lo que recibes.
- Lead con verbo imperativo ("Cobrar", "Llamar", "Renegociar"...).
- Si hay tema común (mismo cliente / riesgo cruzado), explícalo.
- Si no hay tema común, formato lista de 3 acciones.
- Cada acción referencia responsable + plazo concreto.
- Salida en español, JSON estricto, sin markdown extra.`;

  const start = Date.now();
  const response = await callClaude(apiKey, {
    model: HAIKU_MODEL,
    max_tokens: 600,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    cacheSystem: false,
  }, "daily-digest");

  if (!response.ok) {
    const errBody = await response.text();
    return NextResponse.json({ error: `Claude error: ${errBody.slice(0, 300)}` }, { status: 500 });
  }
  const claudeData = await response.json() as {
    content?: { text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const rawText = claudeData.content?.[0]?.text ?? "";
  const inTok = claudeData.usage?.input_tokens ?? 0;
  const outTok = claudeData.usage?.output_tokens ?? 0;

  let parsed: { title: string; body: string };
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : rawText);
  } catch {
    return NextResponse.json({ error: `Claude returned non-JSON: ${rawText.slice(0, 200)}` }, { status: 500 });
  }

  const title = (parsed.title ?? "Top 3 hoy").slice(0, 200);
  const body = (parsed.body ?? "").slice(0, 4000);

  // Archive yesterday's digest (only one fresh digest in inbox at a time)
  await supabase
    .from("agent_insights")
    .update({ state: "archived", updated_at: new Date().toISOString() })
    .eq("agent_id", digestAgentId)
    .in("state", ["new", "seen"]);

  // Create the digest run + insight
  const { data: run, error: runErr } = await supabase
    .from("agent_runs")
    .insert({
      agent_id: digestAgentId,
      status: "completed",
      trigger_type: "scheduled",
      started_at: new Date(start).toISOString(),
      completed_at: new Date().toISOString(),
      duration_seconds: (Date.now() - start) / 1000,
      input_tokens: inTok,
      output_tokens: outTok,
      insights_generated: 1,
      metadata: { source: "daily-digest", referenced_ids: directorTop.map(i => i.id) },
    })
    .select("id")
    .single();
  if (runErr) {
    return NextResponse.json({ error: `run insert failed: ${runErr.message}` }, { status: 500 });
  }

  const referencedCompanies = Array.from(new Set(directorTop.map(i => i.company_name).filter(Boolean)));
  const totalImpact = directorTop.reduce((s, i) => s + (i.business_impact_estimate ?? 0), 0);

  const { data: inserted, error: insErr } = await supabase
    .from("agent_insights")
    .insert({
      agent_id: digestAgentId,
      run_id: run.id,
      insight_type: "daily_digest",
      category: "datos",
      severity: "critical",
      title,
      description: body,
      recommendation: directorTop.map(i =>
        `${i.assignee_name ?? "Responsable"}: ver insight #${i.id} (${i.title.slice(0, 50)}...)`
      ).join(" | "),
      evidence: {
        referenced_insight_ids: directorTop.map(i => i.id),
        referenced_companies: referencedCompanies,
        total_impact_mxn: totalImpact || null,
        directors: Array.from(new Set(directorTop.map(i => i.agent_slug))),
      },
      confidence: 1.0,
      business_impact_estimate: totalImpact || null,
      state: "new",
      assignee_email: "jose.mizrahi@quimibond.com",
      assignee_name: "Jose J. Mizrahi",
      assignee_department: "Direccion",
      assignee_user_id: 7,
    })
    .select("id")
    .single();
  if (insErr) {
    return NextResponse.json({ error: `insight insert failed: ${insErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    digest_insight_id: inserted.id,
    referenced_ids: directorTop.map(i => i.id),
    title,
    body,
    tokens: { input: inTok, output: outTok },
    duration_ms: Date.now() - start,
  });
}
