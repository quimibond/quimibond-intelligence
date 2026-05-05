import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";
import { paginateAll } from "@/lib/queries/_shared/paginate";

/**
 * F-COGS — Costo de ventas: AVCO contable vs BOM-MP recursivo.
 *
 * Régimen real (confirmado 2026-05-04): Quimibond valúa con AVCO. Workcenters
 * sólo en Tejido Circular (go-live mayo 2026); el resto de los procesos
 * NO absorbe MOD+OH al PT al producirse (variable costing implícito).
 * Pre-1-abril-2026 las BOMs incluían MOD+gastos vía RSI56 (archivado).
 *
 * Tres lecturas lado a lado:
 *
 *  1. COGS CONTABLE — `canonical_account_balances`, `account_type =
 *     'expense_direct_cost'`. Es 501.01.x: AVCO al despacho. Hereda
 *     contaminación AVCO histórica del PT producido pre-abril.
 *
 *  2. COGS BOM-MP RECURSIVO — Σ(qty facturada × costo_MP_recursivo)
 *     Para cada producto vendido, explota su BOM recursivamente hasta
 *     llegar a hojas (MP comprada) y suma qty × avg_cost_mxn por hoja.
 *     RPC: `get_cogs_recursive_mp(from, to)` usando
 *     `get_bom_raw_material_cost_per_unit` (UNA BOM primaria por
 *     producto → evita doble conteo cuando hay múltiples BOMs activas).
 *     Cost source para hojas: `canonical_products.avg_cost_mxn` (Odoo
 *     moving-average de compras MP).
 *
 *  3. COGS BOM FLAT (legacy) — `mv_bom_standard_cost.standard_cost_per_unit`
 *     usa el standard_price del componente directo. Útil sólo como
 *     referencia histórica.
 *
 * "Overhead" en este contexto = contable − recursivo. Bajo el régimen
 * actual (variable costing implícito) NO es double counting: refleja
 * (a) contaminación AVCO histórica del PT producido pre-abril (MOD+gastos
 * absorbidos vía RSI56), y (b) drift entre canonical.avg_cost y MP real.
 * El campo `cogsCapaValoracionMxn` reconstruye el "raw" sumando los
 * asientos del journal CAPA DE VALORACIÓN, que pre-abril eran ajuste
 * mensual; post-abril casi no se usan.
 */
export interface CogsComparison {
  period: HistoryRange;
  periodLabel: string;
  monthsCovered: number;

  // 1. COGS contable AS-IS — 501.01.x AVCO al despacho, post cualquier
  //    asiento del diario "CAPA DE VALORACIÓN" del período.
  cogsContableMxn: number;

  // 2. COGS contable RAW = contable + asientos CAPA DE VALORACIÓN del mes.
  //    Reconstruye el saldo de 501.01.x ANTES de los ajustes del journal
  //    CAPA DE VALORACIÓN (pre-abril era ajuste mensual; post-abril casi
  //    no se usa porque RSI56 fue archivado).
  cogsCapaValoracionMxn: number; // monto removido vía CAPA DE VALORACIÓN (positivo)
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

  // Paginated: odoo_invoice_lines out_invoice y:2025 has 9k+ rows (audit
  // 2026-04-29) and would silently truncate at the PostgREST 1000-row cap.
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
      // 1b. "CAPA DE VALORACIÓN" — asientos manuales que ajustaron 501.01
      //     en el período (pre-abril era mensual, post-abril casi no se usa).
      //     Se suman al contable para reconstruir el "raw" pre-ajuste.
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
      // 3. Flat BOM reference — paginated (>1000 rows for typical year).
      paginateAll<{ odoo_product_id: number | null; quantity: number | null }>(
        ({ from, to }) =>
          sb
            .from("odoo_invoice_lines")
            .select("odoo_product_id, quantity")
            .eq("move_type", "out_invoice")
            .gte("invoice_date", bounds.from)
            .lt("invoice_date", bounds.to)
            .order("invoice_date", { ascending: true })
            .order("odoo_line_id", { ascending: true })
            .range(from, to)
      ).then((data) => ({ data, error: null })),
      // 4. Revenue invoice-basis — paginated.
      paginateAll<{ price_subtotal_mxn: number | null }>(({ from, to }) =>
        sb
          .from("odoo_invoice_lines")
          .select("price_subtotal_mxn")
          .eq("move_type", "out_invoice")
          .gte("invoice_date", bounds.from)
          .lt("invoice_date", bounds.to)
          .order("invoice_date", { ascending: true })
          .order("odoo_line_id", { ascending: true })
          .range(from, to)
      ).then((data) => ({ data, error: null })),
    ]);

  type AcctRow = { balance: number | null; period: string };
  const cogsContable = ((cogsAcctRes.data ?? []) as AcctRow[]).reduce(
    (s, r) => s + (Number(r.balance) || 0),
    0
  );
  const monthsCovered = new Set(
    ((cogsAcctRes.data ?? []) as AcctRow[]).map((r) => r.period)
  ).size;

  // CAPA DE VALORACIÓN: asientos manuales históricos para alinear 501.01
  // contra realidad (pre-abril era ajuste mensual). Sumamos los amount_total
  // para reconstruir el "raw" antes del ajuste.
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
    ["sp13-finanzas-cogs-comparison-v3-imports-refunds", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();

export { _getCogsComparisonRaw as _getCogsComparisonForTests };

// Alias para compatibilidad con callers previos.
export const getCogsComparisonCached = (range: HistoryRange) =>
  unstable_cache(
    () => _getCogsComparisonRaw(range),
    ["sp13-finanzas-cogs-comparison-v3-imports-refunds", range],
    { revalidate: 600, tags: ["finanzas"] }
  )();
