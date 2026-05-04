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

export interface AccountSourceJournal {
  journalName: string;
  lineCount: number;
  debitMxn: number;
  creditMxn: number;
  netMxn: number;
  topContraAccounts: string;     // ej. "115.04.01 ($5535k), 115.03.01 ($1078k)"
  pctOfNet: number;              // % del net total de la cuenta
  diagnostic: string | null;     // explicación si hay patrón conocido
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
  sourceJournals: AccountSourceJournal[];
  vendors: AccountVendorBreakdown[];
  recentLines: AccountInvoiceLine[];
}

/**
 * Diagnóstico de patrones de uso de cuenta. Detecta cuando una cuenta
 * está recibiendo cosas que NO matchean su nombre/intención típica.
 */
function diagnoseSourceJournal(
  accountCode: string,
  journalName: string
): string | null {
  // 501.01.01 con journal "Facturas de cliente" = Auto-COGS de Odoo (CAPA inflada)
  if (accountCode.startsWith("501.01.01")) {
    if (
      journalName === "Facturas de cliente" ||
      journalName === "Facturas de cliente de Mostrador" ||
      journalName === "Nota de Crédito"
    ) {
      return "Auto-COGS de Odoo: standard cost del producto vendido. Aquí cae la inflación CAPA porque incluye overhead embebido.";
    }
    if (journalName === "CAPA DE VALORACIÓN") {
      return "Asiento manual de capa para limpiar el overhead duplicado.";
    }
    if (journalName === "Facturas de proveedores") {
      return "Compra directa cargada a esta cuenta (raro en 501.01.01).";
    }
  }
  if (accountCode.startsWith("501.01.02")) {
    if (journalName === "Valoración del inventario") {
      return "Ajustes automáticos de Odoo (revaluación / cierre).";
    }
  }
  if (accountCode.startsWith("501.01.08")) {
    if (journalName === "Valoración del inventario") {
      return "Ajustes de cantidad por conteos físicos (faltantes/sobrantes).";
    }
  }
  // 504.x con Facturas de proveedores = OK (overhead de fábrica via factura)
  if (accountCode.startsWith("504.01") && journalName === "Facturas de proveedores") {
    return "Gasto de proveedor — drilldown a proveedores abajo.";
  }
  if (
    accountCode.startsWith("504") &&
    /depreci/i.test(journalName)
  ) {
    return "Asiento mensual de depreciación.";
  }
  if (
    accountCode.startsWith("501.06") &&
    /nomina/i.test(journalName)
  ) {
    return "Nómina de mano de obra directa.";
  }
  // 6xx general
  if (accountCode.startsWith("6") && journalName === "Facturas de proveedores") {
    return "Gasto admin/ventas vía factura.";
  }
  return null;
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

  // 2. Vendor breakdown + source journals (RPC)
  const [vendorsRes, linesRes, sourceRes] = await Promise.all([
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
    sb.rpc("get_account_source_breakdown", {
      p_account_code: accountCode,
      p_from_period: fromPeriod,
      p_to_period: toPeriod,
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

  type SourceRpc = {
    journal_name: string;
    line_count: number | string;
    debit_mxn: number | string;
    credit_mxn: number | string;
    net_mxn: number | string;
    top_contra_accounts: string | null;
  };
  const sourceRows = (sourceRes.data ?? []) as SourceRpc[];
  const totalNetForPct = sourceRows.reduce(
    (s, r) => s + Math.abs(Number(r.net_mxn) || 0),
    0
  );
  const sourceJournals: AccountSourceJournal[] = sourceRows.map((r) => {
    const net = Number(r.net_mxn) || 0;
    return {
      journalName: r.journal_name,
      lineCount: Number(r.line_count) || 0,
      debitMxn: Number(r.debit_mxn) || 0,
      creditMxn: Number(r.credit_mxn) || 0,
      netMxn: net,
      topContraAccounts: r.top_contra_accounts ?? "",
      pctOfNet:
        totalNetForPct > 0
          ? Math.round((Math.abs(net) / totalNetForPct) * 1000) / 10
          : 0,
      diagnostic: diagnoseSourceJournal(accountCode, r.journal_name),
    };
  });

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
    sourceJournals,
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
    ["sp13-account-expense-detail-v2-source", accountCode, fromPeriod, toPeriod],
    { revalidate: 600, tags: ["finanzas"] }
  )();
