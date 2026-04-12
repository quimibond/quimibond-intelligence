/**
 * Daily Digest — returns top 5 insights for the CEO as JSON or HTML.
 *
 * Usage:
 *   GET /api/daily-digest          → JSON (for frontend widget)
 *   GET /api/daily-digest?html=1   → rendered HTML (for email)
 *
 * This is the "one thing the CEO must see today" endpoint.
 * Pulled from agent_insights with severity=critical|high, state=new|seen,
 * ordered by business impact.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const supabase = getServiceClient();
  const url = new URL(request.url);
  const asHtml = url.searchParams.get("html") === "1";

  try {
    // Get top 5 insights sorted by impact
    const { data: insights } = await supabase
      .from("agent_insights")
      .select("id, title, description, severity, category, business_impact_estimate, assignee_name, company_id, created_at, recommendation, evidence")
      .in("state", ["new", "seen"])
      .in("severity", ["critical", "high"])
      .order("business_impact_estimate", { ascending: false, nullsFirst: false })
      .limit(5);

    // Enrich with company names
    const companyIds = [...new Set((insights ?? []).map(i => i.company_id).filter(Boolean))] as number[];
    const companyMap: Record<number, string> = {};
    if (companyIds.length) {
      const { data: companies } = await supabase
        .from("companies")
        .select("id, name")
        .in("id", companyIds);
      for (const c of companies ?? []) {
        companyMap[c.id] = c.name;
      }
    }

    // Also get KPIs for the digest header
    const [
      { count: newInsightsCount },
      { count: overdueActionsCount },
      { count: pendingActionsCount },
      { data: briefing },
    ] = await Promise.all([
      supabase.from("agent_insights").select("id", { count: "exact", head: true }).eq("state", "new"),
      supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending").lt("due_date", new Date().toISOString().split("T")[0]),
      supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
      supabase.from("briefings").select("summary_text, briefing_date").eq("scope", "daily").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const enriched = (insights ?? []).map(i => ({
      ...i,
      company_name: i.company_id ? (companyMap[i.company_id] ?? null) : null,
    }));

    const payload = {
      date: new Date().toISOString().split("T")[0],
      kpis: {
        new_insights: newInsightsCount ?? 0,
        overdue_actions: overdueActionsCount ?? 0,
        pending_actions: pendingActionsCount ?? 0,
      },
      top_5: enriched,
      latest_briefing: briefing ? {
        date: briefing.briefing_date,
        text: briefing.summary_text?.slice(0, 500),
      } : null,
    };

    if (asHtml) {
      return new NextResponse(renderHtml(payload), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[daily-digest]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function fmtMXN(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function sevBadge(sev: string): string {
  const colors: Record<string, string> = {
    critical: "#dc2626",
    high: "#ea580c",
    medium: "#ca8a04",
  };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${colors[sev] ?? "#6b7280"};color:white;font-size:11px;font-weight:600;text-transform:uppercase;">${sev}</span>`;
}

interface DigestPayload {
  date: string;
  kpis: { new_insights: number; overdue_actions: number; pending_actions: number };
  top_5: Array<{
    id: number;
    title: string;
    description: string;
    severity: string;
    category: string;
    business_impact_estimate: number | null;
    assignee_name: string | null;
    company_name: string | null;
    recommendation: string | null;
  }>;
  latest_briefing: { date: string; text: string } | null;
}

function renderHtml(d: DigestPayload): string {
  const items = d.top_5.map((i, idx) => `
    <div style="margin-bottom:20px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
      <div style="display:flex;align-items:start;gap:12px;margin-bottom:8px;">
        <div style="font-size:24px;font-weight:bold;color:#6b7280;min-width:32px;">${idx + 1}</div>
        <div style="flex:1;">
          <div style="margin-bottom:6px;">${sevBadge(i.severity)} <span style="color:#6b7280;font-size:11px;text-transform:uppercase;margin-left:6px;">${i.category}</span></div>
          <h3 style="margin:0 0 6px 0;font-size:16px;color:#111827;">${i.title}</h3>
          ${i.company_name ? `<div style="color:#6b7280;font-size:13px;margin-bottom:8px;">${i.company_name}</div>` : ""}
          <p style="margin:0 0 10px 0;color:#374151;font-size:14px;line-height:1.5;">${i.description}</p>
          ${i.recommendation ? `<div style="padding:8px 10px;background:#eff6ff;border-left:3px solid #3b82f6;color:#1e40af;font-size:13px;margin-bottom:8px;"><strong>Recomendacion:</strong> ${i.recommendation}</div>` : ""}
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#6b7280;">
            <span>${i.assignee_name ? `→ ${i.assignee_name}` : ""}</span>
            <span style="font-weight:600;color:#059669;">${fmtMXN(i.business_impact_estimate)}</span>
          </div>
        </div>
      </div>
    </div>
  `).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Daily Digest — Quimibond Intelligence</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#ffffff;color:#111827;">
  <div style="margin-bottom:24px;">
    <h1 style="margin:0 0 4px 0;font-size:24px;">Quimibond Intelligence</h1>
    <p style="margin:0;color:#6b7280;font-size:14px;">Resumen ejecutivo · ${d.date}</p>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:24px;">
    <div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;text-align:center;">
      <div style="font-size:24px;font-weight:bold;color:#dc2626;">${d.kpis.new_insights}</div>
      <div style="font-size:11px;color:#991b1b;text-transform:uppercase;">Insights nuevos</div>
    </div>
    <div style="padding:12px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;text-align:center;">
      <div style="font-size:24px;font-weight:bold;color:#ca8a04;">${d.kpis.overdue_actions}</div>
      <div style="font-size:11px;color:#854d0e;text-transform:uppercase;">Acciones vencidas</div>
    </div>
    <div style="padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;text-align:center;">
      <div style="font-size:24px;font-weight:bold;color:#3b82f6;">${d.kpis.pending_actions}</div>
      <div style="font-size:11px;color:#1e40af;text-transform:uppercase;">Pendientes totales</div>
    </div>
  </div>

  <h2 style="margin:0 0 16px 0;font-size:18px;">Top 5 insights del dia</h2>
  ${items || '<p style="color:#6b7280;">No hay insights criticos hoy.</p>'}

  ${d.latest_briefing ? `
  <div style="margin-top:24px;padding:16px;background:#f3f4f6;border-radius:8px;">
    <h3 style="margin:0 0 8px 0;font-size:14px;color:#6b7280;text-transform:uppercase;">Briefing del dia</h3>
    <p style="margin:0;font-size:13px;color:#374151;line-height:1.5;">${d.latest_briefing.text}</p>
  </div>
  ` : ""}

  <p style="margin-top:24px;font-size:11px;color:#9ca3af;text-align:center;">
    Quimibond Intelligence · Powered by 7 directores IA
  </p>
</body>
</html>`;
}
