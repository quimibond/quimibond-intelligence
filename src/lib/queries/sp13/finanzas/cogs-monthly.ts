import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-COGS monthly — serie mensual de ventas vs COGS contable/raw/recursivo.
 *
 * RPC `get_cogs_comparison_monthly(from, to)` devuelve un renglón por mes:
 *   - revenue_product_mxn  = ventas de producto (cuenta 4xx)
 *   - revenue_invoices_mxn = total facturado en odoo_invoice_lines (incluye
 *                            venta de activos como la máquina de marzo 2026)
 *   - cogs_contable        = 501.xx actual (post ajuste capa)
 *   - cogs_capa            = asientos de "CAPA DE VALORACIÓN" del mes
 *   - cogs_raw             = contable + capa (pre ajuste)
 *   - cogs_recursive_mp    = explosión BOM hasta hojas × avg_cost_mxn
 *   - overhead             = raw - recursive (lo que el ajuste manual
 *                            debería haber removido del 501.01)
 *   - margin_{contable,raw,recursive}_pct — siempre contra 4xx
 *   - bom_coverage_pct     = % de líneas de venta con costo recursivo > 0
 *
 * Para surface de anomalías se calcula `status`:
 *   - "ok": margen contable, raw y recursivo razonables
 *   - "warn": margen raw negativo (pre-ajuste) o cobertura BOM < 95%
 *   - "alert": margen contable negativo (post-ajuste, requiere investigar
 *              asiento year-end o venta de activo mezclada)
 */
export interface CogsMonthlyPoint {
  period: string; // YYYY-MM
  revenueProductMxn: number;
  revenueInvoicesMxn: number;
  cogsContableMxn: number;
  cogsCapaValoracionMxn: number;
  cogsContableRawMxn: number;
  cogsRecursiveMpMxn: number;
  overheadMxn: number;
  marginContablePct: number | null;
  marginRawPct: number | null;
  marginRecursivePct: number | null;
  linesTotal: number;
  linesWithCost: number;
  bomCoveragePct: number;
  status: "ok" | "warn" | "alert";
  note: string | null;
}

export interface CogsMonthlyTrend {
  period: HistoryRange;
  periodLabel: string;
  points: CogsMonthlyPoint[];
}

type RpcRow = {
  period: string;
  revenue_product_mxn: number | string;
  revenue_invoices_mxn: number | string;
  cogs_contable_mxn: number | string;
  cogs_capa_valoracion_mxn: number | string;
  cogs_contable_raw_mxn: number | string;
  cogs_recursive_mp_mxn: number | string;
  overhead_mxn: number | string;
  margin_contable_pct: number | string | null;
  margin_raw_pct: number | string | null;
  margin_recursive_pct: number | string | null;
  lines_total: number | string;
  lines_with_cost: number | string;
  bom_coverage_pct: number | string;
};

function classify(row: Omit<CogsMonthlyPoint, "status" | "note">): {
  status: CogsMonthlyPoint["status"];
  note: string | null;
} {
  // Negative post-adjust margin means year-end true-up or mixed asset sale.
  if (row.marginContablePct != null && row.marginContablePct < 0) {
    return {
      status: "alert",
      note: "Margen contable negativo: revisar ajustes year-end o venta de activo",
    };
  }
  if (row.marginRawPct != null && row.marginRawPct < 0) {
    return {
      status: "warn",
      note: "Margen raw negativo — pre-ajuste de capa. Revisar si el mes aún necesita asiento",
    };
  }
  if (row.bomCoveragePct < 95) {
    return {
      status: "warn",
      note: `Cobertura BOM ${row.bomCoveragePct.toFixed(0)}%: productos sin BOM inflan el overhead aparente`,
    };
  }
  // Large gap between invoice revenue and 4xx signals an asset sale
  // (e.g. Mar 2026 $11.6M, Dec 2025 $5.9M).
  const gap = row.revenueInvoicesMxn - row.revenueProductMxn;
  if (gap > 2_000_000) {
    return {
      status: "warn",
      note: `Venta de activo fijo detectada: factura \$${(gap / 1_000_000).toFixed(1)}M por encima del 4xx`,
    };
  }
  return { status: "ok", note: null };
}

async function _getCogsMonthlyRaw(range: HistoryRange): Promise<CogsMonthlyTrend> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const { data, error } = await sb.rpc("get_cogs_comparison_monthly", {
    p_date_from: bounds.from,
    p_date_to: bounds.to,
  });
  if (error) {
    console.error("[getCogsMonthly] rpc failed", error.message);
    return { period: range, periodLabel: bounds.label, points: [] };
  }
  const points: CogsMonthlyPoint[] = ((data ?? []) as RpcRow[]).map((r) => {
    const base: Omit<CogsMonthlyPoint, "status" | "note"> = {
      period: r.period,
      revenueProductMxn: Number(r.revenue_product_mxn) || 0,
      revenueInvoicesMxn: Number(r.revenue_invoices_mxn) || 0,
      cogsContableMxn: Number(r.cogs_contable_mxn) || 0,
      cogsCapaValoracionMxn: Number(r.cogs_capa_valoracion_mxn) || 0,
      cogsContableRawMxn: Number(r.cogs_contable_raw_mxn) || 0,
      cogsRecursiveMpMxn: Number(r.cogs_recursive_mp_mxn) || 0,
      overheadMxn: Number(r.overhead_mxn) || 0,
      marginContablePct:
        r.margin_contable_pct == null ? null : Number(r.margin_contable_pct),
      marginRawPct: r.margin_raw_pct == null ? null : Number(r.margin_raw_pct),
      marginRecursivePct:
        r.margin_recursive_pct == null ? null : Number(r.margin_recursive_pct),
      linesTotal: Number(r.lines_total) || 0,
      linesWithCost: Number(r.lines_with_cost) || 0,
      bomCoveragePct: Number(r.bom_coverage_pct) || 0,
    };
    return { ...base, ...classify(base) };
  });
  return {
    period: range,
    periodLabel: bounds.label,
    points,
  };
}

// Default export is cached (10 min TTL) to speed up period switches.
export const getCogsMonthly = (range: HistoryRange) =>
  unstable_cache(
    () => _getCogsMonthlyRaw(range),
    ["sp13-finanzas-cogs-monthly", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();

export const getCogsMonthlyCached = getCogsMonthly;
