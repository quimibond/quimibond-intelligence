import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * Auditoría de costos: reconciliación de que el GL de fabricación/operación se
 * reparte completo, sin duplicados ni huecos, por departamento (centro de costo)
 * y por familia de producto.
 *
 * RPCs: get_cost_audit_by_department, get_cost_audit_by_family,
 * get_cost_factors_monthly (pool GL de fab/op por mes). Migration 20260612i.
 */

export interface DeptRow {
  departamento: string;
  modMxn: number;
  overheadMxn: number;
  totalMxn: number;
}

export interface FamilyRow {
  familia: string;
  n: number;
  mpMxn: number;
  fabMxn: number;
  opMxn: number;
  revenueMxn: number;
  marginPct: number | null;
}

export interface CostAuditSnapshot {
  period: string;
  months: string[];
  departments: DeptRow[];
  deptTotalMxn: number;
  families: FamilyRow[];
  // Reconciliación pool GL vs absorbido
  glFabMxn: number;
  glOpMxn: number;
  absorbedFabMxn: number;
  absorbedOpMxn: number;
  fabDriftPct: number | null;
  byMonth: { mes: string; glFab: number; absorbedFab: number }[];
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

async function _raw(range: HistoryRange): Promise<CostAuditSnapshot | null> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);

  const factorsRes = await sb.rpc("get_cost_factors_monthly", {
    p_months_back: 36,
  });
  const factorRows = (factorsRes.data ?? []) as Record<string, unknown>[];

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

  const [deptResults, famResults] = await Promise.all([
    Promise.all(
      monthsToUse.map((m) =>
        sb.rpc("get_cost_audit_by_department", { p_period: m }),
      ),
    ),
    Promise.all(
      monthsToUse.map((m) =>
        sb.rpc("get_cost_audit_by_family", { p_period: m }),
      ),
    ),
  ]);

  // Departamentos — sumar por nombre a través de los meses
  const deptMap = new Map<string, DeptRow>();
  for (const res of deptResults) {
    for (const r of (res.data ?? []) as Record<string, unknown>[]) {
      const key = r.departamento as string;
      const cur =
        deptMap.get(key) ??
        ({ departamento: key, modMxn: 0, overheadMxn: 0, totalMxn: 0 } as DeptRow);
      cur.modMxn += n(r.mod_mxn);
      cur.overheadMxn += n(r.overhead_mxn);
      cur.totalMxn += n(r.total_mxn);
      deptMap.set(key, cur);
    }
  }
  const departments = [...deptMap.values()].sort(
    (a, b) => b.totalMxn - a.totalMxn,
  );
  const deptTotalMxn = departments.reduce((s, d) => s + d.totalMxn, 0);

  // Familias — sumar por nombre
  const famMap = new Map<string, FamilyRow>();
  let absorbedFabMxn = 0;
  let absorbedOpMxn = 0;
  for (const res of famResults) {
    for (const r of (res.data ?? []) as Record<string, unknown>[]) {
      const key = r.familia as string;
      const cur =
        famMap.get(key) ??
        ({
          familia: key,
          n: 0,
          mpMxn: 0,
          fabMxn: 0,
          opMxn: 0,
          revenueMxn: 0,
          marginPct: null,
        } as FamilyRow);
      cur.n = Math.max(cur.n, n(r.n)); // n de productos: máximo del rango (no acumular)
      cur.mpMxn += n(r.mp_mxn);
      cur.fabMxn += n(r.fab_mxn);
      cur.opMxn += n(r.op_mxn);
      cur.revenueMxn += n(r.revenue_mxn);
      famMap.set(key, cur);
      absorbedFabMxn += n(r.fab_mxn);
      absorbedOpMxn += n(r.op_mxn);
    }
  }
  const families = [...famMap.values()]
    .map((f) => {
      const costo = f.mpMxn + f.fabMxn + f.opMxn;
      f.marginPct =
        f.revenueMxn > 0 ? ((f.revenueMxn - costo) / f.revenueMxn) * 100 : null;
      return f;
    })
    .sort((a, b) => b.fabMxn - a.fabMxn);

  // Pool GL del rango
  const inRange = factorRows.filter((f) =>
    monthsToUse.includes(f.mes as string),
  );
  const glFabMxn = inRange.reduce((s, f) => s + n(f.gastos_fabricacion_mxn), 0);
  const glOpMxn = inRange.reduce((s, f) => s + n(f.gastos_operacion_mxn), 0);

  // Por mes: GL fab vs absorbido fab
  const absorbedByMonth = new Map<string, number>();
  monthsToUse.forEach((m, i) => {
    const fam = (famResults[i].data ?? []) as Record<string, unknown>[];
    absorbedByMonth.set(
      m,
      fam.reduce((s, r) => s + n(r.fab_mxn), 0),
    );
  });
  const byMonth = monthsToUse.map((m) => ({
    mes: m,
    glFab: n(
      inRange.find((f) => f.mes === m)?.gastos_fabricacion_mxn,
    ),
    absorbedFab: absorbedByMonth.get(m) ?? 0,
  }));

  const fabDriftPct =
    glFabMxn > 0 ? ((absorbedFabMxn - glFabMxn) / glFabMxn) * 100 : null;

  return {
    period,
    months: monthsToUse,
    departments,
    deptTotalMxn,
    families,
    glFabMxn,
    glOpMxn,
    absorbedFabMxn,
    absorbedOpMxn,
    fabDriftPct,
    byMonth,
  };
}

export const getCostAuditSnapshot = (range: HistoryRange) =>
  unstable_cache(() => _raw(range), ["sp13-cost-audit-v1", String(range)], {
    revalidate: 300,
    tags: ["sp13", "finanzas", "cost-centers"],
  })();
