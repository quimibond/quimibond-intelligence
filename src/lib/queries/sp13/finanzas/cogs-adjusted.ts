import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-COGS — Costo de ventas: contable vs ajustado a materia prima (BOM).
 *
 * Dos enfoques lado a lado:
 *
 *  1. COGS CONTABLE
 *     Suma de cuentas contables tipo `expense_direct_cost`
 *     (canonical_account_balances). Incluye mano de obra directa,
 *     depreciación de maquinaria y cualquier gasto registrado en 501.xx
 *     — es decir, overhead operativo además de material.
 *
 *  2. COGS AJUSTADO (BOM materia prima)
 *     Σ(cantidad facturada × mv_bom_standard_cost.standard_cost_per_unit)
 *     sobre todas las líneas de factura tipo `out_invoice` emitidas en el
 *     período. Solo considera el costo de los componentes de la BOM
 *     (materia prima), sin labor ni overhead.
 *
 * La diferencia (`overheadMxn`) expone cuánto del costo contable es
 * overhead (labor, depreciación, indirectos) vs. puro material.
 *
 * Caveat: mv_bom_standard_cost aplica el cost del componente tal como
 * Odoo lo registra (standard_price). Para componentes que a su vez son
 * manufacturados, ese standard_price puede incluir overhead nested.
 * Para productos con componentes comprados directo (raw material real),
 * refleja solo materia prima.
 */
export interface CogsComparison {
  period: HistoryRange;
  periodLabel: string;
  monthsCovered: number;

  // Accounting-based COGS
  cogsContableMxn: number;

  // BOM material-only COGS
  cogsBomMaterialMxn: number;
  invoiceLinesTotal: number;
  invoiceLinesWithBom: number;
  bomCoveragePct: number;

  // Revenue for margin context
  revenueMxn: number;

  // Derived
  overheadMxn: number; // contable - bom_material
  overheadPctOfContable: number;
  grossMarginContablePct: number | null; // (rev - contable) / rev * 100
  grossMarginMaterialPct: number | null; // (rev - bom) / rev * 100
}

async function _getCogsComparisonRaw(range: HistoryRange): Promise<CogsComparison> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);

  const [cogsAcctRes, linesRes] = await Promise.all([
    // Accounting COGS: expense_direct_cost bucket for the selected months
    sb
      .from("canonical_account_balances")
      .select("balance, period")
      .eq("account_type", "expense_direct_cost")
      .eq("deprecated", false)
      .gte("period", bounds.fromMonth)
      .lte("period", bounds.toMonth.slice(0, 7)),
    // Invoice lines joined to BOM standard cost (material only).
    // PostgREST embedded resource syntax: filter parent + read child FK.
    sb
      .from("odoo_invoice_lines")
      .select(
        "odoo_product_id, quantity, price_subtotal_mxn, product_ref, invoice_date"
      )
      .eq("move_type", "out_invoice")
      .gte("invoice_date", bounds.from)
      .lt("invoice_date", bounds.to),
  ]);

  type AcctRow = { balance: number | null; period: string };
  const cogsContable = ((cogsAcctRes.data ?? []) as AcctRow[]).reduce(
    (s, r) => s + (Number(r.balance) || 0),
    0
  );
  const monthsCovered = new Set(
    ((cogsAcctRes.data ?? []) as AcctRow[]).map((r) => r.period)
  ).size;

  type LineRow = {
    odoo_product_id: number | null;
    quantity: number | null;
    price_subtotal_mxn: number | null;
  };
  const lines = (linesRes.data ?? []) as LineRow[];
  const productIds = Array.from(
    new Set(lines.map((l) => l.odoo_product_id).filter((x): x is number => x != null))
  );

  // Fetch BOM cost only for products actually sold (avoids full MV scan)
  const bomCostByProduct = new Map<number, number>();
  if (productIds.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const { data } = await sb
        .from("mv_bom_standard_cost")
        .select("finished_product_id, standard_cost_per_unit")
        .in("finished_product_id", chunk);
      for (const r of (data ?? []) as Array<{
        finished_product_id: number | null;
        standard_cost_per_unit: number | null;
      }>) {
        if (r.finished_product_id != null && r.standard_cost_per_unit != null) {
          bomCostByProduct.set(
            r.finished_product_id,
            Number(r.standard_cost_per_unit)
          );
        }
      }
    }
  }

  let cogsBomMaterial = 0;
  let revenue = 0;
  let linesWithBom = 0;
  for (const l of lines) {
    revenue += Number(l.price_subtotal_mxn) || 0;
    if (l.odoo_product_id != null) {
      const unitCost = bomCostByProduct.get(l.odoo_product_id);
      if (unitCost != null) {
        cogsBomMaterial += (Number(l.quantity) || 0) * unitCost;
        linesWithBom++;
      }
    }
  }

  const bomCoveragePct =
    lines.length > 0 ? (linesWithBom / lines.length) * 100 : 0;
  const overhead = cogsContable - cogsBomMaterial;
  const overheadPct =
    cogsContable > 0 ? (overhead / cogsContable) * 100 : 0;
  const grossMarginContable =
    revenue > 0 ? ((revenue - cogsContable) / revenue) * 100 : null;
  const grossMarginMaterial =
    revenue > 0 ? ((revenue - cogsBomMaterial) / revenue) * 100 : null;

  return {
    period: range,
    periodLabel: bounds.label,
    monthsCovered,
    cogsContableMxn: Math.round(cogsContable * 100) / 100,
    cogsBomMaterialMxn: Math.round(cogsBomMaterial * 100) / 100,
    invoiceLinesTotal: lines.length,
    invoiceLinesWithBom: linesWithBom,
    bomCoveragePct: Math.round(bomCoveragePct * 10) / 10,
    revenueMxn: Math.round(revenue * 100) / 100,
    overheadMxn: Math.round(overhead * 100) / 100,
    overheadPctOfContable: Math.round(overheadPct * 10) / 10,
    grossMarginContablePct:
      grossMarginContable == null
        ? null
        : Math.round(grossMarginContable * 10) / 10,
    grossMarginMaterialPct:
      grossMarginMaterial == null
        ? null
        : Math.round(grossMarginMaterial * 10) / 10,
  };
}

export async function getCogsComparison(
  range: HistoryRange
): Promise<CogsComparison> {
  return _getCogsComparisonRaw(range);
}

export { _getCogsComparisonRaw as _getCogsComparisonForTests };

// Cached version — keyed by range
export const getCogsComparisonCached = (range: HistoryRange) =>
  unstable_cache(
    () => _getCogsComparisonRaw(range),
    ["sp13-finanzas-cogs-comparison", range],
    { revalidate: 60, tags: ["finanzas"] }
  )();
