import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F7 — Drift systemico SAT ↔ P&L.
 *
 * Para cada mes del período elegido, comparamos:
 *  - ingresos SAT  = sum(canonical_invoices.amount_total_mxn_sat) emitidas, no canceladas
 *  - ingresos P&L  = abs(gold_pl_statement.total_income)
 * Drift = |sat − pl| / max(sat,pl). `critical` = drift > 25% en al menos 1 mes.
 */
export interface DriftMonth {
  period: string;
  satMxn: number;
  plMxn: number;
  driftPct: number;
  diffMxn: number;
}

export interface DriftSummary {
  range: HistoryRange;
  months: DriftMonth[];
  monthsCritical: number;
  monthsWarning: number;
  maxDriftPct: number;
  cumulativeDiffMxn: number;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
}

async function _getDriftSummaryRaw(range: HistoryRange): Promise<DriftSummary> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);

  const [plRes, satRes] = await Promise.all([
    sb
      .from("gold_pl_statement")
      .select("period, total_income")
      .gte("period", bounds.fromMonth)
      .lte("period", bounds.toMonth.slice(0, 7)),
    sb
      .from("canonical_invoices")
      .select("invoice_date, amount_total_mxn_sat, amount_total_mxn_resolved, amount_total_mxn_odoo")
      .eq("is_quimibond_relevant", true)
      .eq("direction", "issued")
      .neq("estado_sat", "cancelado")
      .gte("invoice_date", bounds.from)
      .lt("invoice_date", bounds.to),
  ]);

  const satByMonth = new Map<string, number>();
  type SatRow = {
    invoice_date: string | null;
    amount_total_mxn_sat: number | null;
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  for (const r of (satRes.data ?? []) as SatRow[]) {
    if (!r.invoice_date) continue;
    const period = r.invoice_date.slice(0, 7);
    const amt =
      Number(r.amount_total_mxn_sat ?? r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0;
    satByMonth.set(period, (satByMonth.get(period) ?? 0) + amt);
  }

  const plByMonth = new Map<string, number>();
  type PlRow = { period: string | null; total_income: number | null };
  for (const r of (plRes.data ?? []) as PlRow[]) {
    if (!r.period) continue;
    plByMonth.set(r.period, Math.abs(Number(r.total_income) || 0));
  }

  const allMonths = new Set<string>([
    ...Array.from(satByMonth.keys()),
    ...Array.from(plByMonth.keys()),
  ]);
  const months: DriftMonth[] = Array.from(allMonths)
    .sort()
    .map((p) => {
      const sat = satByMonth.get(p) ?? 0;
      const pl = plByMonth.get(p) ?? 0;
      const mx = Math.max(sat, pl);
      const driftPct = mx > 0 ? Math.round((Math.abs(sat - pl) / mx) * 1000) / 10 : 0;
      return {
        period: p,
        satMxn: Math.round(sat),
        plMxn: Math.round(pl),
        driftPct,
        diffMxn: Math.round(sat - pl),
      };
    });

  const monthsCritical = months.filter((m) => m.driftPct > 25).length;
  const monthsWarning = months.filter((m) => m.driftPct > 10 && m.driftPct <= 25).length;
  const maxDriftPct = months.reduce((max, m) => Math.max(max, m.driftPct), 0);
  const cumulativeDiffMxn = months.reduce((s, m) => s + m.diffMxn, 0);

  let severity: DriftSummary["severity"] = "info";
  let title = "";
  let description = "";
  if (monthsCritical > 0) {
    severity = "critical";
    const sign = cumulativeDiffMxn >= 0 ? "perdiendo" : "agregando";
    title = `Drift SAT vs P&L crítico: ${monthsCritical} mes${monthsCritical === 1 ? "" : "es"} >25%`;
    description = `Se está ${sign} ${fmt(Math.abs(cumulativeDiffMxn))} de utilidad aparente en el período. Revisa timing de ingresos, notas de crédito, o diferencias de tipo de cambio.`;
  } else if (monthsWarning > 0) {
    severity = "warning";
    title = `Drift SAT vs P&L moderado (${monthsWarning} mes${monthsWarning === 1 ? "" : "es"} 10-25%)`;
    description = `Diferencia acumulada ${fmt(Math.abs(cumulativeDiffMxn))}. Dentro de rangos razonables pero vigilar.`;
  } else {
    severity = "info";
    title = "SAT y P&L alineados";
    description = `Drift máx. ${maxDriftPct.toFixed(1)}% en el período. Contabilidad cuadra con timbrado.`;
  }

  return {
    range,
    months,
    monthsCritical,
    monthsWarning,
    maxDriftPct,
    cumulativeDiffMxn,
    severity,
    title,
    description,
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

export const getDriftSummary = unstable_cache(
  _getDriftSummaryRaw,
  ["sp13-finanzas-drift"],
  { revalidate: 60, tags: ["finanzas"] }
);
