import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Drilldown de gasto contable por proveedor.
 *
 * Para una cuenta GL específica (ej. 504.01.0005 MANTENIMIENTOS FABRICA),
 * descompone el gasto del período en:
 *   - Top proveedores con totales
 *   - Detalle factura-por-factura (entry + line)
 *   - Trend mensual histórico (últimos 12-24 meses)
 *
 * Source: `odoo_account_entries_stock.lines_stock` JSON server-side
 * unnest vía RPCs `get_account_vendor_breakdown` y `get_account_invoice_lines`.
 */

export interface AccountVendorBreakdown {
  vendorCompanyId: number | null;
  vendorName: string;
  vendorRfc: string | null;
  totalMxn: number;
  lineCount: number;
  invoiceCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface AccountInvoiceLine {
  date: string;
  entryName: string;
  journalName: string | null;
  vendorCompanyId: number | null;
  vendorName: string;
  productId: number | null;
  productRef: string | null;
  description: string | null;
  debitMxn: number;
  creditMxn: number;
  netMxn: number;
}

export interface AccountTrendPoint {
  period: string;
  balanceMxn: number;
}

export interface AccountExpenseDetail {
  accountCode: string;
  accountName: string | null;
  accountType: string | null;
  fromPeriod: string;
  toPeriod: string;
  totalMxn: number;            // suma del período
  trend12m: AccountTrendPoint[]; // últimos 12 meses incluyendo el actual
  avgRecent3mMxn: number;      // promedio últimos 3 meses cerrados (excluye actual)
  changeVsAvgPct: number | null;
  vendors: AccountVendorBreakdown[];
  recentLines: AccountInvoiceLine[];
}

function priorPeriod(period: string, n: number): string {
  const [y, m] = period.split("-").map((s) => parseInt(s, 10));
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function _getAccountExpenseDetailRaw(
  accountCode: string,
  fromPeriod: string,
  toPeriod: string
): Promise<AccountExpenseDetail> {
  const sb = getServiceClient();

  // 1. Account metadata + total + 12m trend
  const trendStart = priorPeriod(fromPeriod, 11);
  const balanceRes = await sb
    .from("canonical_account_balances")
    .select("account_code, account_name, account_type, period, balance")
    .eq("account_code", accountCode)
    .eq("deprecated", false)
    .gte("period", trendStart)
    .lte("period", toPeriod)
    .order("period", { ascending: true });

  type BalRow = {
    account_code: string;
    account_name: string | null;
    account_type: string | null;
    period: string;
    balance: number | null;
  };
  const balRows = (balanceRes.data ?? []) as BalRow[];
  const accountName = balRows[0]?.account_name ?? null;
  const accountType = balRows[0]?.account_type ?? null;

  // Build trend: ALL months in window, fill missing with 0
  const allMonths: string[] = [];
  let cursor = trendStart;
  while (cursor <= toPeriod) {
    allMonths.push(cursor);
    cursor = priorPeriod(cursor, -1);
  }
  const balByPeriod = new Map(
    balRows.map((r) => [r.period, Number(r.balance) || 0])
  );
  const trend12m: AccountTrendPoint[] = allMonths.map((period) => ({
    period,
    balanceMxn: Math.round((balByPeriod.get(period) ?? 0) * 100) / 100,
  }));

  // Total of selected period
  const periodMonths: string[] = [];
  let pc = fromPeriod;
  while (pc <= toPeriod) {
    periodMonths.push(pc);
    pc = priorPeriod(pc, -1);
  }
  const totalMxn = periodMonths.reduce(
    (s, p) => s + (balByPeriod.get(p) ?? 0),
    0
  );

  // Avg of 3 months prior (closed) — for change vs run rate
  const avgPeriods = [
    priorPeriod(fromPeriod, 1),
    priorPeriod(fromPeriod, 2),
    priorPeriod(fromPeriod, 3),
  ];
  const avgRecent3m =
    avgPeriods.reduce((s, p) => s + (balByPeriod.get(p) ?? 0), 0) / 3;
  const changeVsAvgPct =
    Math.abs(avgRecent3m) > 100
      ? ((totalMxn - avgRecent3m) / Math.abs(avgRecent3m)) * 100
      : null;

  // 2. Vendor breakdown (RPC)
  const [vendorsRes, linesRes] = await Promise.all([
    sb.rpc("get_account_vendor_breakdown", {
      p_account_code: accountCode,
      p_from_period: fromPeriod,
      p_to_period: toPeriod,
    }),
    sb.rpc("get_account_invoice_lines", {
      p_account_code: accountCode,
      p_from_period: fromPeriod,
      p_to_period: toPeriod,
      p_limit: 100,
    }),
  ]);

  type VendorRpc = {
    vendor_company_id: number | null;
    vendor_name: string;
    vendor_rfc: string | null;
    total_mxn: number | string;
    line_count: number | string;
    invoice_count: number | string;
    first_date: string | null;
    last_date: string | null;
  };
  const vendors: AccountVendorBreakdown[] = (
    (vendorsRes.data ?? []) as VendorRpc[]
  ).map((v) => ({
    vendorCompanyId: v.vendor_company_id,
    vendorName: v.vendor_name,
    vendorRfc: v.vendor_rfc,
    totalMxn: Number(v.total_mxn) || 0,
    lineCount: Number(v.line_count) || 0,
    invoiceCount: Number(v.invoice_count) || 0,
    firstDate: v.first_date,
    lastDate: v.last_date,
  }));

  type LineRpc = {
    date: string;
    entry_name: string | null;
    journal_name: string | null;
    vendor_company_id: number | null;
    vendor_name: string;
    product_id: number | null;
    product_ref: string | null;
    description: string | null;
    debit_mxn: number | string;
    credit_mxn: number | string;
    net_mxn: number | string;
  };
  const recentLines: AccountInvoiceLine[] = (
    (linesRes.data ?? []) as LineRpc[]
  ).map((l) => ({
    date: l.date,
    entryName: l.entry_name ?? "",
    journalName: l.journal_name,
    vendorCompanyId: l.vendor_company_id,
    vendorName: l.vendor_name,
    productId: l.product_id,
    productRef: l.product_ref,
    description: l.description,
    debitMxn: Number(l.debit_mxn) || 0,
    creditMxn: Number(l.credit_mxn) || 0,
    netMxn: Number(l.net_mxn) || 0,
  }));

  return {
    accountCode,
    accountName,
    accountType,
    fromPeriod,
    toPeriod,
    totalMxn: Math.round(totalMxn * 100) / 100,
    trend12m,
    avgRecent3mMxn: Math.round(avgRecent3m * 100) / 100,
    changeVsAvgPct:
      changeVsAvgPct == null ? null : Math.round(changeVsAvgPct * 10) / 10,
    vendors,
    recentLines,
  };
}

export const getAccountExpenseDetail = (
  accountCode: string,
  fromPeriod: string,
  toPeriod: string
) =>
  unstable_cache(
    () => _getAccountExpenseDetailRaw(accountCode, fromPeriod, toPeriod),
    ["sp13-account-expense-detail-v1", accountCode, fromPeriod, toPeriod],
    { revalidate: 600, tags: ["finanzas"] }
  )();
