import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F3 — P&L KPIs + waterfall for a given HistoryRange.
 *
 * Single source of truth: canonical_account_balances con filtros por
 * account_code prefix (para ingresos) y account_type por-row (para egresos).
 * Nunca usamos gold_pl_statement.by_level_1 — agrupa a prefix y pierde la
 * distinción entre expense_direct_cost y expense_depreciation dentro del
 * mismo prefijo (504.01 vs 504.08-23).
 *
 * Breakdown por cuenta:
 *   501.01    Cost of sales (debería ser solo MP; residuo vs BOM = CAPA pendiente)
 *   501.06    Mano de obra directa
 *   502       Compras importación
 *   504.01    Overhead fábrica (renta, energía, servicios)
 *   504.08-23 Depreciación fábrica  ← Odoo la pone debajo de EBIT
 *   6xx       Gastos operativos admin/ventas
 *   613       Depreciación CORPO    ← Odoo la pone debajo de EBIT
 *
 * Estructura de subtotales (alineada al Estado de Resultados de Odoo):
 *   Ventas (4xx)
 *   − Costo de ingresos (501 + 502 + 504.01)        ← NO incluye depreciación
 *   = Ganancia bruta
 *   − Gasto de operación (6xx, sin 613 dep.)        ← NO incluye depreciación
 *   = Ingreso de operación (EBIT)
 *   + Otros ingresos (7xx + 503 + 899)
 *   − Depreciación (504.08-23 + 613)                ← línea separada
 *   = Utilidad neta
 *
 * SIGN CONVENTION (Mexican chart of accounts):
 * - income accounts  → balance stored NEGATIVE → negate for display
 * - expense accounts → balance stored POSITIVE → keep as-is
 */
export interface PnlKpis {
  period: HistoryRange;
  periodLabel: string;
  // Ingresos
  ingresosPl: number; // cuenta 4xx — ventas de producto
  otrosIngresosNetoMxn: number; // cuenta 7xx neto
  ingresosSat: number;
  // Costo de ingresos (Odoo: "Total Menos costo de ingresos") — NO incluye dep
  costoVentas: number;
  // COGS breakdown por cuenta
  cogs501_01Mxn: number; // Cost of sales (debería ser solo MP)
  mod501_06Mxn: number; // Mano de obra directa
  compras502Mxn: number; // Compras importación
  overhead504_01Mxn: number; // Overhead fábrica (504.01-07, sin dep)
  depFabrica504Mxn: number; // Depreciación maquinaria/edificio fábrica (504.08-23)
  // Gasto de operación (Odoo: "Total Menos gasto de operación") — NO incluye dep
  gastosOperativos: number;
  gastosOp6xxMxn: number; // 6xx expense (sin 613 dep)
  depCorpoMxn: number; // 613 expense_depreciation (CORPO)
  // Depreciación total (Odoo: "Total Menos gastos de otro tipo")
  depreciacionTotalMxn: number; // 504.08-23 + 613
  // Subtotales (alineados a Odoo)
  utilidadBruta: number; // Ganancia bruta = ventas − costoVentas
  utilidadOperativaMxn: number; // EBIT = utilidadBruta − gastosOperativos
  utilidadNeta: number;
  netIncome: number;
  driftPct: number | null;
  monthsCovered: number;
}

export interface WaterfallPoint {
  label: string;
  value: number;
  kind: "positive" | "negative" | "total";
}

type PeriodWindow = {
  fromMonth: string;
  toMonth: string;
  label: string;
  monthsCovered: number;
};

type RawRow = {
  balance: number | null;
  period: string | null;
  account_code: string | null;
  account_type: string | null;
};

type Aggregates = {
  window: PeriodWindow;
  ventasProducto: number;
  otrosIngresosNeto: number;
  // expense breakdown
  cogs501_01: number;
  mod501_06: number;
  compras502: number;
  overhead504_01: number;
  depFabrica504: number;
  gastosOp6xx: number;
  depCorpo613: number;
};

async function fetchPlAggregates(range: HistoryRange): Promise<Aggregates> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const toMonth = bounds.toMonth.slice(0, 7);

  // Paginate: PostgREST in Supabase enforces a hard `db-max-rows=1000` cap
  // that .range(0, 49999) does NOT bypass (the server clamps regardless of
  // client-supplied range). For y:2025 expense alone we have 1,263 rows
  // (12 months × 105 accounts), so a single fetch silently dropped 263 rows
  // = ~$20M of overhead/dep/gasto-op missing → utilidad neta inflated $20M
  // (audit 2026-04-29). Loop with stable ORDER BY until a page returns
  // fewer than the page size.
  const PAGE = 1000;
  const fetchAllByBucket = async (bucket: "income" | "expense"): Promise<RawRow[]> => {
    const all: RawRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("canonical_account_balances")
        .select("balance, period, account_code, account_type")
        .eq("balance_sheet_bucket", bucket)
        .eq("deprecated", false)
        .gte("period", bounds.fromMonth)
        .lte("period", toMonth)
        .order("period", { ascending: true })
        .order("account_code", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as RawRow[];
      all.push(...rows);
      if (rows.length < PAGE) break;
      if (from + PAGE > 100_000) {
        throw new Error(`fetchPlAggregates: ${bucket} exceeded 100k rows`);
      }
    }
    return all;
  };

  const [incRows, expRows] = await Promise.all([
    fetchAllByBucket("income"),
    fetchAllByBucket("expense"),
  ]);

  // Ingresos split por account_code prefix
  let ventasProducto = 0;
  let otrosIngresosNeto = 0;
  for (const r of incRows) {
    const bal = Number(r.balance) || 0;
    const code = r.account_code ?? "";
    if (code.startsWith("4")) ventasProducto -= bal; // negate (stored credit)
    else if (code.startsWith("7")) otrosIngresosNeto -= bal;
  }

  // Expenses split por prefix + account_type individual
  let cogs501_01 = 0;
  let mod501_06 = 0;
  let compras502 = 0;
  let overhead504_01 = 0;
  let depFabrica504 = 0;
  let gastosOp6xx = 0;
  let depCorpo613 = 0;

  for (const r of expRows) {
    const bal = Number(r.balance) || 0;
    const code = r.account_code ?? "";
    const type = r.account_type ?? "";
    if (code.startsWith("501.01")) cogs501_01 += bal;
    else if (code.startsWith("501.06")) mod501_06 += bal;
    else if (code.startsWith("502")) compras502 += bal;
    else if (code.startsWith("504")) {
      if (type === "expense_depreciation") depFabrica504 += bal;
      else overhead504_01 += bal; // 504.01.xxxx
    } else if (code.startsWith("6")) {
      if (type === "expense_depreciation") depCorpo613 += bal;
      else gastosOp6xx += bal;
    } else {
      // Fallback: cuentas 5xx restantes que no cumplan arriba van a gastos op
      // por tipo. Esto cubre cualquier cuenta nueva sin explotar el P&L.
      if (type === "expense_direct_cost") cogs501_01 += bal;
      else if (type === "expense_depreciation") depCorpo613 += bal;
      else gastosOp6xx += bal;
    }
  }

  // monthsCovered = distinct periods seen
  const periods = new Set<string>();
  for (const r of [...incRows, ...expRows]) {
    if (r.period) periods.add(r.period);
  }

  return {
    window: {
      fromMonth: bounds.fromMonth,
      toMonth: bounds.toMonth,
      label: bounds.label,
      monthsCovered: periods.size,
    },
    ventasProducto,
    otrosIngresosNeto,
    cogs501_01,
    mod501_06,
    compras502,
    overhead504_01,
    depFabrica504,
    gastosOp6xx,
    depCorpo613,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function deriveTotals(agg: Aggregates) {
  // Estructura Odoo: depreciación va como línea separada después de EBIT,
  // no se mezcla con costo de ingresos ni con gasto de operación.
  const costoVentas =
    agg.cogs501_01 + agg.mod501_06 + agg.compras502 + agg.overhead504_01;
  const gastosOperativos = agg.gastosOp6xx;
  const depreciacionTotal = agg.depFabrica504 + agg.depCorpo613;
  const utilidadBruta = agg.ventasProducto - costoVentas;
  const utilidadOperativa = utilidadBruta - gastosOperativos;
  const utilidadNeta =
    utilidadOperativa + agg.otrosIngresosNeto - depreciacionTotal;
  return {
    costoVentas,
    gastosOperativos,
    depreciacionTotal,
    utilidadBruta,
    utilidadOperativa,
    utilidadNeta,
  };
}

async function _getPnlKpisRaw(range: HistoryRange): Promise<PnlKpis> {
  const sb = getServiceClient();
  const agg = await fetchPlAggregates(range);
  const t = deriveTotals(agg);

  // SAT revenue for the same window (emitidas dentro del rango)
  const bounds = periodBoundsForRange(range);
  const { data: satData, error: satErr } = await sb
    .from("canonical_invoices")
    .select(
      "amount_total_mxn_sat, amount_total_mxn_resolved, amount_total_mxn_odoo, invoice_date"
    )
    .eq("is_quimibond_relevant", true)
    .eq("direction", "issued")
    .or("estado_sat.is.null,estado_sat.neq.cancelado")
    .gte("invoice_date", bounds.from)
    .lt("invoice_date", bounds.to);
  if (satErr) {
    console.error("[getPnlKpis] SAT aggregation failure", satErr.message);
  }
  type SatRow = {
    amount_total_mxn_sat: number | null;
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  const ingresosSat = (satData ?? []).reduce(
    (s, r) =>
      s +
      (Number(
        (r as SatRow).amount_total_mxn_sat ??
          (r as SatRow).amount_total_mxn_resolved ??
          (r as SatRow).amount_total_mxn_odoo
      ) || 0),
    0
  );

  const maxSide = Math.max(agg.ventasProducto, ingresosSat);
  const driftPct =
    maxSide > 0
      ? Math.round((Math.abs(agg.ventasProducto - ingresosSat) / maxSide) * 1000) / 10
      : null;

  return {
    period: range,
    periodLabel: agg.window.label,
    ingresosPl: round2(agg.ventasProducto),
    otrosIngresosNetoMxn: round2(agg.otrosIngresosNeto),
    ingresosSat: round2(ingresosSat),
    costoVentas: round2(t.costoVentas),
    cogs501_01Mxn: round2(agg.cogs501_01),
    mod501_06Mxn: round2(agg.mod501_06),
    compras502Mxn: round2(agg.compras502),
    overhead504_01Mxn: round2(agg.overhead504_01),
    depFabrica504Mxn: round2(agg.depFabrica504),
    gastosOperativos: round2(t.gastosOperativos),
    gastosOp6xxMxn: round2(agg.gastosOp6xx),
    depCorpoMxn: round2(agg.depCorpo613),
    depreciacionTotalMxn: round2(t.depreciacionTotal),
    utilidadBruta: round2(t.utilidadBruta),
    utilidadOperativaMxn: round2(t.utilidadOperativa),
    utilidadNeta: round2(t.utilidadNeta),
    netIncome: round2(t.utilidadNeta),
    monthsCovered: agg.window.monthsCovered,
    driftPct,
  };
}

// Cached (10 min TTL). Evita pegar a Supabase en cada cambio de período
// cuando ya tenemos el KPI set para ese range cacheado. El waterfall usa
// los mismos agregados que KPIs — los compartimos via la misma llamada.
export const getPnlKpis = (range: HistoryRange) =>
  unstable_cache(
    () => _getPnlKpisRaw(range),
    ["sp13-finanzas-pnl-kpis-v6-paginated", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();

async function _getPnlWaterfallRaw(
  range: HistoryRange
): Promise<WaterfallPoint[]> {
  const agg = await fetchPlAggregates(range);
  const t = deriveTotals(agg);
  return [
    { label: "Ventas de producto", value: round2(agg.ventasProducto), kind: "positive" },
    { label: "Costo de ingresos", value: round2(-t.costoVentas), kind: "negative" },
    { label: "Ganancia bruta", value: round2(t.utilidadBruta), kind: "total" },
    { label: "Gasto de operación", value: round2(-t.gastosOperativos), kind: "negative" },
    { label: "EBIT", value: round2(t.utilidadOperativa), kind: "total" },
    {
      label: "Otros ingresos",
      value: round2(agg.otrosIngresosNeto),
      kind: agg.otrosIngresosNeto >= 0 ? "positive" : "negative",
    },
    {
      label: "Depreciación",
      value: round2(-t.depreciacionTotal),
      kind: "negative",
    },
    { label: "Utilidad neta", value: round2(t.utilidadNeta), kind: "total" },
  ];
}

export const getPnlWaterfall = (range: HistoryRange) =>
  unstable_cache(
    () => _getPnlWaterfallRaw(range),
    ["sp13-finanzas-pnl-waterfall-v5-paginated", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();
