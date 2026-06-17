import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * Costeo por MARGEN DE CONTRIBUCIÓN (mejor práctica para decisiones).
 *
 * Costo variable por unidad = MP (último costo) + energía (única conversión
 * variable; MOD/renta/deprec/overhead/operación son FIJOS, confirmado CEO).
 * Contribución = precio − costo variable. Los fijos son costo del período →
 * punto de equilibrio. RPCs get_contribution_by_product, get_fixed_costs_monthly
 * (migration 20260612j).
 */

export interface ContributionRow {
  productRef: string | null;
  productName: string | null;
  uom: string | null;
  qtySold: number;
  revenueMxn: number;
  mpMxn: number;
  energiaVarMxn: number;
  costoVariableMxn: number;
  contribucionMxn: number;
  cmUnitMxn: number | null;
  cmPct: number | null;
}

export interface ContributionSnapshot {
  period: string;
  revenueMxn: number;
  variableMxn: number;
  contributionMxn: number;
  cmPctGlobal: number | null;
  fixedPeriodMxn: number;
  fixedAvgMonthlyMxn: number;
  resultMxn: number;
  breakEvenMonthlyMxn: number | null;
  rows: ContributionRow[];
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

async function _raw(range: HistoryRange): Promise<ContributionSnapshot | null> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);

  const [factorsRes, fixedRes] = await Promise.all([
    sb.rpc("get_cost_factors_monthly", { p_months_back: 36 }),
    sb.rpc("get_fixed_costs_monthly", { p_months_back: 36 }),
  ]);
  const factorRows = (factorsRes.data ?? []) as Record<string, unknown>[];
  const fixedRows = (fixedRes.data ?? []) as Record<string, unknown>[];

  let monthsToUse = factorRows
    .filter(
      (f) =>
        (f.mes as string) >= bounds.fromMonth &&
        (f.mes as string) <= bounds.toMonth,
    )
    .map((f) => f.mes as string)
    .sort();
  if (monthsToUse.length > 24) monthsToUse = monthsToUse.slice(-24);
  if (monthsToUse.length === 0) monthsToUse = [bounds.toMonth];

  const period =
    monthsToUse.length > 1
      ? `${monthsToUse[0]}…${monthsToUse[monthsToUse.length - 1]}`
      : monthsToUse[0];

  const contribResults = await Promise.all(
    monthsToUse.map((m) =>
      sb.rpc("get_contribution_by_product", { p_period: m }),
    ),
  );

  // Agregar por producto a través de los meses
  const map = new Map<string, ContributionRow>();
  for (const res of contribResults) {
    for (const r of (res.data ?? []) as Record<string, unknown>[]) {
      const key = (r.product_ref as string) ?? `id:${r.odoo_product_id}`;
      const cur =
        map.get(key) ??
        ({
          productRef: (r.product_ref as string) ?? null,
          productName: (r.product_name as string) ?? null,
          uom: (r.uom as string) ?? null,
          qtySold: 0,
          revenueMxn: 0,
          mpMxn: 0,
          energiaVarMxn: 0,
          costoVariableMxn: 0,
          contribucionMxn: 0,
          cmUnitMxn: null,
          cmPct: null,
        } as ContributionRow);
      cur.qtySold += n(r.qty_sold);
      cur.revenueMxn += n(r.revenue_mxn);
      cur.mpMxn += n(r.mp_mxn);
      cur.energiaVarMxn += n(r.energia_var_mxn);
      cur.costoVariableMxn += n(r.costo_variable_mxn);
      cur.contribucionMxn += n(r.contribucion_mxn);
      map.set(key, cur);
    }
  }
  const rows = [...map.values()]
    .map((r) => {
      r.cmUnitMxn = r.qtySold > 0 ? r.contribucionMxn / r.qtySold : null;
      r.cmPct =
        r.revenueMxn > 0 ? (r.contribucionMxn / r.revenueMxn) * 100 : null;
      return r;
    })
    .sort((a, b) => b.contribucionMxn - a.contribucionMxn);

  const revenueMxn = rows.reduce((s, r) => s + r.revenueMxn, 0);
  const variableMxn = rows.reduce((s, r) => s + r.costoVariableMxn, 0);
  const contributionMxn = rows.reduce((s, r) => s + r.contribucionMxn, 0);
  const cmPctGlobal = revenueMxn > 0 ? (contributionMxn / revenueMxn) * 100 : null;

  // Fijos: suma de los meses del rango (real) + promedio mensual 12m (estable)
  const fixedByMonth = new Map(
    fixedRows.map((f) => [f.mes as string, n(f.fijos_mxn)]),
  );
  const fixedPeriodMxn = monthsToUse.reduce(
    (s, m) => s + (fixedByMonth.get(m) ?? 0),
    0,
  );
  const last12 = fixedRows
    .filter((f) => n(f.fijos_mxn) > 0)
    .slice(-12)
    .map((f) => n(f.fijos_mxn));
  const fixedAvgMonthlyMxn =
    last12.length > 0 ? last12.reduce((s, v) => s + v, 0) / last12.length : 0;

  const resultMxn = contributionMxn - fixedPeriodMxn;
  const breakEvenMonthlyMxn =
    cmPctGlobal && cmPctGlobal > 0
      ? fixedAvgMonthlyMxn / (cmPctGlobal / 100)
      : null;

  return {
    period,
    revenueMxn,
    variableMxn,
    contributionMxn,
    cmPctGlobal,
    fixedPeriodMxn,
    fixedAvgMonthlyMxn,
    resultMxn,
    breakEvenMonthlyMxn,
    rows,
  };
}

export const getContributionSnapshot = (range: HistoryRange) =>
  unstable_cache(() => _raw(range), ["sp13-contribution-v1", String(range)], {
    revalidate: 300,
    tags: ["sp13", "finanzas", "cost-centers"],
  })();
