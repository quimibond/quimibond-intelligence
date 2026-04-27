import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-INV-ADJ — Ajustes de inventario que tocan P&L (501.01.02 COSTO PRIMO).
 *
 * Source: silver RPCs `get_inventory_adjustments_monthly` (lente contable)
 *         + `get_inventory_adjustments_top_products` (drill por SKU).
 *
 * Cuadre validado al peso contra `canonical_account_balances`:
 *   Dec 2025 NET 501.01.02 = $10,544,206 = Dr 11,923,422 − Cr 1,379,216
 *
 * El audit del CEO descubrió que 501.01.02 absorbe el residual del año
 * (+$9.71M en 2025) y que Dec 2025 sólo aporta +$10.54M, atípico vs los
 * ±$0.5M de los demás meses. La causa: shrinkage físico anual ($6.4M),
 * waste de máquina cardadora ($3.4M, real), variancia de manufactura ($1.3M).
 * Todo es costo legítimo, pero concentrado mal en el tiempo.
 *
 * Este bloque expone la decomposición mensual + top SKUs para que el
 * contador y el CEO vean dónde aterriza el residual cada mes.
 */

export type AdjAccountBucket =
  | "cogs_501_01_01"
  | "cost_primo_501_01_02"
  | "mod_501_06"
  | "cogs_501_other"
  | "depreciation_504_08"
  | "purchase_504"
  | "inventory_115"
  | "other_account";

export type AdjJournalCategory =
  | "inventory_valuation"
  | "depreciation"
  | "payroll"
  | "vendor_bill"
  | "gastos_varios"
  | "manual_other"
  | "capa_manual"
  | "taxes"
  | "customer_invoice"
  | "other";

export type AdjPhysicalSubcategory =
  | "physical_count"
  | "manual_edit"
  | "lot_transfer"
  | "scrap"
  | "reclassification"
  | "manufacturing_op"
  | "manufacturing_consume"
  | "manufacturing_produce"
  | "purchase_in"
  | "sale_out"
  | "inventory_loss"
  | "inventory_gain"
  | "depreciation"
  | "payroll"
  | "vendor_bill"
  | "manual_journal"
  | "capa_manual"
  | "unlinked"
  | "other"
  | "other_stock_move";

export interface InventoryAdjMonthlyRow {
  period: string;                    // "YYYY-MM"
  accountBucket: AdjAccountBucket;
  journalCategory: AdjJournalCategory;
  debit: number;
  credit: number;
  net: number;
  lineCount: number;
}

export interface InventoryAdjTopProduct {
  productRef: string | null;
  odooProductId: number | null;
  topSubcategory: AdjPhysicalSubcategory | null;
  debit: number;
  credit: number;
  net: number;
  lineCount: number;
}

export interface InventoryAdjustmentsSummary {
  period: HistoryRange;
  periodLabel: string;
  periodFrom: string;                // ISO date
  periodTo: string;                  // ISO date (exclusive)
  /** Monthly net by account bucket × journal category. */
  monthly: InventoryAdjMonthlyRow[];
  /** Top SKUs by net Dr on focusedAccountCodes within the period. */
  topProducts: InventoryAdjTopProduct[];
  /** Account codes used as focus filter for monthly + top (default 501.01.02). */
  focusedAccountCodes: string[];
  /** Net Dr on focusedAccountCodes across the period (sum of monthly nets). */
  focusedNetMxn: number;
  /** Total adjustment activity (gross |Dr| + |Cr|) on focusedAccountCodes. */
  focusedGrossMxn: number;
}

type MonthlyRpcRow = {
  period: string;
  account_bucket: string;
  journal_category: string;
  debit: number | string | null;
  credit: number | string | null;
  net: number | string | null;
  line_count: number | string | null;
};

type TopRpcRow = {
  product_ref: string | null;
  odoo_product_id: number | null;
  physical_subcategory_top: string | null;
  debit: number | string | null;
  credit: number | string | null;
  net: number | string | null;
  line_count: number | string | null;
};

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export async function getInventoryAdjustments(
  range: HistoryRange,
  opts: { focusedAccountCodes?: string[]; topLimit?: number } = {}
): Promise<InventoryAdjustmentsSummary> {
  const focusedAccountCodes = opts.focusedAccountCodes ?? ["501.01.02"];
  const topLimit = opts.topLimit ?? 20;
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);

  const [monthlyRes, topRes] = await Promise.all([
    sb.rpc("get_inventory_adjustments_monthly", {
      p_date_from: bounds.from,
      p_date_to: bounds.to,
      p_account_codes: focusedAccountCodes,
    }),
    sb.rpc("get_inventory_adjustments_top_products", {
      p_date_from: bounds.from,
      p_date_to: bounds.to,
      p_account_codes: focusedAccountCodes,
      p_limit: topLimit,
    }),
  ]);

  if (monthlyRes.error) {
    console.error("[getInventoryAdjustments] monthly", monthlyRes.error.message);
  }
  if (topRes.error) {
    console.error("[getInventoryAdjustments] top", topRes.error.message);
  }

  const monthly: InventoryAdjMonthlyRow[] = (
    (monthlyRes.data ?? []) as MonthlyRpcRow[]
  ).map((r) => ({
    period: r.period,
    accountBucket: r.account_bucket as AdjAccountBucket,
    journalCategory: r.journal_category as AdjJournalCategory,
    debit: num(r.debit),
    credit: num(r.credit),
    net: num(r.net),
    lineCount: Number(r.line_count ?? 0) || 0,
  }));

  const topProducts: InventoryAdjTopProduct[] = (
    (topRes.data ?? []) as TopRpcRow[]
  ).map((r) => ({
    productRef: r.product_ref,
    odooProductId: r.odoo_product_id,
    topSubcategory: (r.physical_subcategory_top as AdjPhysicalSubcategory) ?? null,
    debit: num(r.debit),
    credit: num(r.credit),
    net: num(r.net),
    lineCount: Number(r.line_count ?? 0) || 0,
  }));

  const focusedNetMxn = monthly.reduce((s, r) => s + r.net, 0);
  const focusedGrossMxn = monthly.reduce(
    (s, r) => s + r.debit + r.credit,
    0
  );

  return {
    period: range,
    periodLabel: bounds.label,
    periodFrom: bounds.from,
    periodTo: bounds.to,
    monthly,
    topProducts,
    focusedAccountCodes,
    focusedNetMxn,
    focusedGrossMxn,
  };
}

/* ── Display helpers ────────────────────────────────────────────────────── */

export const ACCOUNT_BUCKET_LABEL: Record<AdjAccountBucket, string> = {
  cost_primo_501_01_02: "Costo primo (501.01.02)",
  cogs_501_01_01: "COGS (501.01.01)",
  mod_501_06: "MOD (501.06)",
  cogs_501_other: "COGS otros (501)",
  depreciation_504_08: "Depreciación (504.08)",
  purchase_504: "Compras (504)",
  inventory_115: "Inventario (115)",
  other_account: "Otra cuenta",
};

export const JOURNAL_CATEGORY_LABEL: Record<AdjJournalCategory, string> = {
  inventory_valuation: "Valoración de inventario",
  depreciation: "Depreciaciones",
  payroll: "Nómina",
  vendor_bill: "Factura proveedor",
  gastos_varios: "Gastos varios",
  manual_other: "Manual (operaciones varias)",
  capa_manual: "CAPA manual",
  taxes: "Impuestos",
  customer_invoice: "Factura cliente",
  other: "Otro",
};

export const PHYSICAL_SUBCAT_LABEL: Record<AdjPhysicalSubcategory, string> = {
  physical_count: "Conteo físico",
  manual_edit: "Edición manual",
  lot_transfer: "Transferencia de lote",
  scrap: "Scrap",
  reclassification: "Reclasificación",
  manufacturing_op: "Manufactura (operación)",
  manufacturing_consume: "Manufactura (consumo MP)",
  manufacturing_produce: "Manufactura (FG recibido)",
  purchase_in: "Compra entrante",
  sale_out: "Venta saliente",
  inventory_loss: "Pérdida inventario",
  inventory_gain: "Ganancia inventario",
  depreciation: "Depreciación",
  payroll: "Nómina",
  vendor_bill: "Factura proveedor",
  manual_journal: "Asiento manual",
  capa_manual: "CAPA manual",
  unlinked: "Asiento manual (sin stock_move)",
  other: "Otro",
  other_stock_move: "Otro movimiento",
};
