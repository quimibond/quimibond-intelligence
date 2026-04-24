import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-COGS — Costo de ventas: contable vs recursive BOM (solo materia prima).
 *
 * Tres lecturas lado a lado:
 *
 *  1. COGS CONTABLE (canonical_account_balances, account_type =
 *     'expense_direct_cost'). Es lo que aparece en el P&L. Incluye mano
 *     de obra directa, energía, depreciación — NO es puro material.
 *
 *  2. COGS AJUSTADO RECURSIVO — Σ(qty facturada × costo_MP_recursivo)
 *     Para cada producto vendido, explota su BOM recursivamente hasta
 *     llegar a hojas (productos sin BOM = MP comprada) y suma el costo
 *     de compra de cada hoja. RPC: `get_cogs_recursive_mp(from, to)`
 *     usa el SQL function `get_bom_raw_material_cost_per_unit` que
 *     resuelve UNA BOM primaria por producto (evita doble conteo
 *     cuando hay múltiples BOMs activas).
 *
 *     Cost source para hojas: canonical_products.avg_cost_mxn
 *     (Odoo moving-average de compras para MP).
 *
 *  3. COGS BOM FLAT (legacy) — `mv_bom_standard_cost.standard_cost_per_unit`
 *     usa el standard_price del componente directo (incluye overhead
 *     cuando el componente es sub-ensamble). Inflado ~68% vs real.
 *     Se muestra para referencia pero el cálculo accionable es el
 *     recursivo.
 *
 * Overhead implícito = contable - recursivo. Positivo = el contable
 * incluye overhead que debería sacarse con asientos de capa (como hizo
 * el user en marzo). Negativo = el recursivo está inflando algún
 * avg_cost_mxn de MP.
 */
export interface CogsComparison {
  period: HistoryRange;
  periodLabel: string;
  monthsCovered: number;

  // 1. COGS contable AS-IS (lo que aparece en el P&L después de cualquier
  //    ajuste manual que ya hayan hecho en el diario "CAPA DE VALORACIÓN")
  cogsContableMxn: number;

  // 2. COGS contable RAW = contable + capa de valoración
  //    Es decir, lo que estaría en 501.01 sin el ajuste del user.
  //    Útil para meses no ajustados aún.
  cogsCapaValoracionMxn: number; // monto que el user removió (positivo)
  cogsContableRawMxn: number; // contable + capa

  // 3. COGS recursivo MP (desde explosión BOM hasta hojas)
  cogsRecursiveMpMxn: number;
  invoiceLinesTotal: number;
  invoiceLinesWithBom: number;
  bomCoveragePct: number;

  // Legacy flat BOM reference
  cogsBomFlatMxn: number;

  // Revenue for margin context.
  // revenueMxn         = ventas de producto (cuenta 4xx) — denominador correcto para margen de MP.
  // revenueInvoicesMxn = total facturado según odoo_invoice_lines (incluye venta de activos
  //                       como la máquina de marzo, donde la factura refleja precio total
  //                       pero el P&L solo reconoce la utilidad en 7xx). Solo referencia.
  revenueMxn: number;
  revenueInvoicesMxn: number;

  // Derived metrics
  overheadMxn: number; // raw - recursivo (overhead real que debió removerse)
  overheadPctOfRaw: number;
  grossMarginContablePct: number | null;
  grossMarginRawPct: number | null;
  grossMarginRecursivePct: number | null;
}

async function _getCogsComparisonRaw(range: HistoryRange): Promise<CogsComparison> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);

  const [cogsAcctRes, capaRes, recursiveRes, bomFlatLinesRes, invoiceRevRes] =
    await Promise.all([
      // 1a. COGS contable actual (501.01 post-adjustment ya aplicado)
      sb
        .from("canonical_account_balances")
        .select("balance, period")
        .eq("account_type", "expense_direct_cost")
        .eq("deprecated", false)
        .gte("period", bounds.fromMonth)
        .lte("period", bounds.toMonth.slice(0, 7)),
      // 1b. "CAPA DE VALORACIÓN" — asientos del user removiendo overhead
      //     de 501.01 en el período. SUMAR estos al contable → raw
      sb
        .from("odoo_account_entries_stock")
        .select("amount_total, date")
        .eq("journal_name", "CAPA DE VALORACIÓN")
        .gte("date", bounds.from)
        .lt("date", bounds.to),
      // 2. COGS recursivo MP + revenue 4xx canonical (ambos vienen del RPC
      //    ahora que get_cogs_recursive_mp usa get_product_sales_revenue).
      sb.rpc("get_cogs_recursive_mp", {
        p_date_from: bounds.from,
        p_date_to: bounds.to,
      }),
      // 3. Flat BOM reference (legacy MV — solo para tarjeta de referencia)
      sb
        .from("odoo_invoice_lines")
        .select("odoo_product_id, quantity")
        .eq("move_type", "out_invoice")
        .gte("invoice_date", bounds.from)
        .lt("invoice_date", bounds.to),
      // 4. Revenue invoice-basis (para detectar venta de activos: el gap
      //    vs cuenta 4xx revela máquina/equipo vendidos facturados pero
      //    cuyo P&L solo reconoce la utilidad en 7xx).
      sb
        .from("odoo_invoice_lines")
        .select("price_subtotal_mxn")
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

  // CAPA DE VALORACIÓN: el user hace un credit a 501.01 para sacar el
  // overhead. Los entries son siempre credit positivo, sumamos para
  // reconstruir el contable raw antes del ajuste.
  type CapaRow = { amount_total: number | null };
  const cogsCapaValoracion = ((capaRes.data ?? []) as CapaRow[]).reduce(
    (s, r) => s + (Number(r.amount_total) || 0),
    0
  );
  const cogsContableRaw = cogsContable + cogsCapaValoracion;

  type RecRow = {
    lines_total: number | string;
    lines_with_cost: number | string;
    revenue_mxn: number | string;
    cogs_recursive_mp: number | string;
  };
  const rec = (
    Array.isArray(recursiveRes.data)
      ? (recursiveRes.data[0] as RecRow | undefined)
      : (recursiveRes.data as RecRow | undefined)
  ) ?? {
    lines_total: 0,
    lines_with_cost: 0,
    revenue_mxn: 0,
    cogs_recursive_mp: 0,
  };
  const linesTotal = Number(rec.lines_total) || 0;
  const linesWithCost = Number(rec.lines_with_cost) || 0;
  // RPC ya devuelve revenue 4xx (cuenta de producto).
  const revenue = Number(rec.revenue_mxn) || 0;
  const cogsRecursive = Number(rec.cogs_recursive_mp) || 0;

  // Invoice-basis revenue (incluye venta de activos fijos). Se calcula
  // sumando todas las líneas — la triplete IEPS (lista+, descuento-, neta+)
  // se cancela aritméticamente a la neta.
  type InvRow = { price_subtotal_mxn: number | null };
  const revenueInvoices = ((invoiceRevRes.data ?? []) as InvRow[]).reduce(
    (s, r) => s + (Number(r.price_subtotal_mxn) || 0),
    0
  );

  // Flat BOM reference for comparison (legacy)
  type LineRow = {
    odoo_product_id: number | null;
    quantity: number | null;
  };
  const flatLines = (bomFlatLinesRes.data ?? []) as LineRow[];
  const productIds = Array.from(
    new Set(
      flatLines
        .map((l) => l.odoo_product_id)
        .filter((x): x is number => x != null)
    )
  );
  const bomFlatByProduct = new Map<number, number>();
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
        if (
          r.finished_product_id != null &&
          r.standard_cost_per_unit != null &&
          !bomFlatByProduct.has(r.finished_product_id)
        ) {
          // Use the first BOM per product (matches recursive primary-BOM
          // resolution). mv_bom_standard_cost returns one row per BOM so
          // products with multiple active BOMs would otherwise inflate.
          bomFlatByProduct.set(
            r.finished_product_id,
            Number(r.standard_cost_per_unit)
          );
        }
      }
    }
  }
  let cogsBomFlat = 0;
  for (const l of flatLines) {
    if (l.odoo_product_id != null) {
      const unit = bomFlatByProduct.get(l.odoo_product_id);
      if (unit != null) cogsBomFlat += (Number(l.quantity) || 0) * unit;
    }
  }

  const bomCoveragePct =
    linesTotal > 0 ? (linesWithCost / linesTotal) * 100 : 0;
  // Overhead real = raw (pre ajuste) - recursivo puro material
  const overhead = cogsContableRaw - cogsRecursive;
  const overheadPctOfRaw =
    cogsContableRaw > 0 ? (overhead / cogsContableRaw) * 100 : 0;
  const grossMarginContable =
    revenue > 0 ? ((revenue - cogsContable) / revenue) * 100 : null;
  const grossMarginRaw =
    revenue > 0 ? ((revenue - cogsContableRaw) / revenue) * 100 : null;
  const grossMarginRecursive =
    revenue > 0 ? ((revenue - cogsRecursive) / revenue) * 100 : null;

  return {
    period: range,
    periodLabel: bounds.label,
    monthsCovered,
    cogsContableMxn: Math.round(cogsContable * 100) / 100,
    cogsCapaValoracionMxn: Math.round(cogsCapaValoracion * 100) / 100,
    cogsContableRawMxn: Math.round(cogsContableRaw * 100) / 100,
    cogsRecursiveMpMxn: Math.round(cogsRecursive * 100) / 100,
    invoiceLinesTotal: linesTotal,
    invoiceLinesWithBom: linesWithCost,
    bomCoveragePct: Math.round(bomCoveragePct * 10) / 10,
    cogsBomFlatMxn: Math.round(cogsBomFlat * 100) / 100,
    revenueMxn: Math.round(revenue * 100) / 100,
    revenueInvoicesMxn: Math.round(revenueInvoices * 100) / 100,
    overheadMxn: Math.round(overhead * 100) / 100,
    overheadPctOfRaw: Math.round(overheadPctOfRaw * 10) / 10,
    grossMarginContablePct:
      grossMarginContable == null
        ? null
        : Math.round(grossMarginContable * 10) / 10,
    grossMarginRawPct:
      grossMarginRaw == null ? null : Math.round(grossMarginRaw * 10) / 10,
    grossMarginRecursivePct:
      grossMarginRecursive == null
        ? null
        : Math.round(grossMarginRecursive * 10) / 10,
  };
}

// Default export is cached (10 min TTL) to speed up period switches.
// Tests import _getCogsComparisonForTests for the uncached implementation.
export const getCogsComparison = (range: HistoryRange) =>
  unstable_cache(
    () => _getCogsComparisonRaw(range),
    ["sp13-finanzas-cogs-comparison", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();

export { _getCogsComparisonRaw as _getCogsComparisonForTests };

// Alias para compatibilidad con callers previos.
export const getCogsComparisonCached = (range: HistoryRange) =>
  unstable_cache(
    () => _getCogsComparisonRaw(range),
    ["sp13-finanzas-cogs-comparison", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();
