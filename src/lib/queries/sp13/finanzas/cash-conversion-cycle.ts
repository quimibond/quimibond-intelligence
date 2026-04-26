import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F-CCC — Cash Conversion Cycle.
 *
 * Mide cuántos días tarda el cash en regresar al banco después de
 * comprar materia prima. Métrica clave de eficiencia de capital de
 * trabajo en manufactura:
 *
 *   CCC = DSO + DIO − DPO
 *
 *   DSO (Days Sales Outstanding):
 *     Cuántos días tarda en cobrar a clientes después de facturar.
 *     DSO = AR_open / (Revenue_365d / 365)
 *
 *   DIO (Days Inventory Outstanding):
 *     Cuántos días el inventario está parado antes de venderse.
 *     DIO = Inventory / (COGS_365d / 365)
 *
 *   DPO (Days Payable Outstanding):
 *     Cuántos días tardamos en pagar a proveedores.
 *     DPO = AP_open / (Purchases_365d / 365)
 *
 * Para textil mexicano benchmark típico:
 *   - DSO 45-75d (clientes pagan 30-60d post-factura)
 *   - DIO 60-120d (rotación de inventario lenta por producción)
 *   - DPO 30-60d (proveedores aceptan 30d normalmente)
 *   - CCC 60-150d (positivo = cash atorado en operación)
 *
 * Insights accionables:
 *   - DSO alto → cobrar más rápido (cobranza dura, factoring)
 *   - DIO alto → reducir inventario (mejor planning, JIT)
 *   - DPO bajo → estirar pago a proveedores (en Quimibond ya alto)
 *
 * Refresh 1h.
 */

export interface CashConversionCycleSnapshot {
  asOfDate: string;
  // Balances actuales
  arOpenMxn: number;
  inventoryMxn: number;
  apOpenMxn: number;
  // Flujos rolling 12 meses
  revenue12mMxn: number;
  cogs12mMxn: number;
  purchases12mMxn: number;
  // Métricas (días)
  dso: number;
  dio: number;
  dpo: number;
  ccc: number;
  // Benchmark textil mexicano (tipo)
  benchmark: { dso: number; dio: number; dpo: number; ccc: number };
  // Trend mensual
  monthlyTrend: Array<{
    period: string;
    arMxn: number;
    inventoryMxn: number;
    apMxn: number;
    revenueRolling12m: number;
    cogsRolling12m: number;
    purchasesRolling12m: number;
    dso: number;
    dio: number;
    dpo: number;
    ccc: number;
  }>;
  // Cash atorado
  workingCapitalTiedMxn: number; // CCC × revenue_daily
}

const safeDays = (numerator: number, dailyFlow: number): number => {
  if (dailyFlow <= 0) return 0;
  return Math.round((numerator / dailyFlow) * 10) / 10;
};

async function _getCashConversionCycleRaw(): Promise<CashConversionCycleSnapshot> {
  const sb = getServiceClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // Pull canonical_account_balances 24m para tener historia rolling 12.
  // Necesitamos: receivable, asset_current (incluye inventory),
  // liability_payable, income (4xx), expense_direct_cost.
  const lookback24m = (() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 24, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  type AbRow = {
    period: string;
    account_code: string;
    balance: number;
    balance_sheet_bucket: string;
    account_type: string | null;
  };

  const PAGE = 1000;
  const allRows: AbRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("canonical_account_balances")
      .select("period, account_code, balance, balance_sheet_bucket, account_type")
      .eq("deprecated", false)
      .gte("period", lookback24m)
      .or(
        "balance_sheet_bucket.eq.asset,balance_sheet_bucket.eq.liability,balance_sheet_bucket.eq.income,balance_sheet_bucket.eq.expense"
      )
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as AbRow[];
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
    if (offset > 30_000) break; // safety
  }

  // Aggregations per period
  type PeriodAgg = {
    revenue4xx: number; // monthly
    cogsDirect: number; // monthly (501+502+504 expense_direct_cost)
    arDelta: number; // monthly delta
    inventoryDelta: number;
    apDelta: number;
  };
  const byPeriod = new Map<string, PeriodAgg>();
  for (const r of allRows) {
    const acc =
      byPeriod.get(r.period) ??
      ({
        revenue4xx: 0,
        cogsDirect: 0,
        arDelta: 0,
        inventoryDelta: 0,
        apDelta: 0,
      } as PeriodAgg);
    const code = r.account_code;
    const bal = Number(r.balance) || 0;

    if (r.balance_sheet_bucket === "income" && code.startsWith("4")) {
      acc.revenue4xx -= bal; // income credit-normal → negate for display positive
    }
    if (r.balance_sheet_bucket === "expense") {
      if (
        code.startsWith("501") ||
        code.startsWith("502") ||
        code.startsWith("504")
      ) {
        acc.cogsDirect += bal;
      }
    }
    // Detect AR/inventory/AP by account code prefix (matches get_cash_reconciliation buckets)
    // AR: usually 105.* or 110-114
    if (code.startsWith("105") || code.startsWith("11")) {
      // 11x is asset_current or asset_receivable
      // Use bucket heuristic via account_type if available
      // Simpler: hardcode known prefixes
      if (
        code.startsWith("105.05") ||
        code.startsWith("105.06") ||
        code.startsWith("110") ||
        code.startsWith("111") ||
        code.startsWith("112") ||
        code.startsWith("113")
      ) {
        // receivables / clients
        acc.arDelta += bal;
      } else if (code.startsWith("115")) {
        acc.inventoryDelta += bal;
      }
    }
    if (
      code.startsWith("201") ||
      code.startsWith("205")
    ) {
      // payables / acreedores
      // negate because liabilities are credit-normal
      acc.apDelta += -bal;
    }
    byPeriod.set(r.period, acc);
  }

  // Cumulative running totals to get end-of-month balances
  const periods = [...byPeriod.keys()].sort();
  let arRunning = 0;
  let invRunning = 0;
  let apRunning = 0;
  type Snapshot = {
    period: string;
    ar: number;
    inv: number;
    ap: number;
    revenueMonth: number;
    cogsMonth: number;
  };
  const snapshots: Snapshot[] = [];
  for (const p of periods) {
    const agg = byPeriod.get(p)!;
    arRunning += agg.arDelta;
    invRunning += agg.inventoryDelta;
    apRunning += agg.apDelta;
    snapshots.push({
      period: p,
      ar: arRunning,
      inv: invRunning,
      ap: apRunning,
      revenueMonth: agg.revenue4xx,
      cogsMonth: agg.cogsDirect,
    });
  }

  // Pull purchases (canonical_invoices direction=received) por mes 12-24m
  const purch12mStart = (() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 24, 1);
    return d.toISOString().slice(0, 10);
  })();
  type InvRow = {
    invoice_date: string | null;
    amount_total_mxn_resolved: number | null;
  };
  const purchases: InvRow[] = [];
  offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("canonical_invoices")
      .select("invoice_date, amount_total_mxn_resolved")
      .eq("direction", "received")
      .eq("is_quimibond_relevant", true)
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .gte("invoice_date", purch12mStart)
      .gt("amount_total_mxn_resolved", 0)
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as InvRow[];
    purchases.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
    if (offset > 30_000) break;
  }
  const purchasesByMonth = new Map<string, number>();
  for (const r of purchases) {
    if (!r.invoice_date) continue;
    const ym = r.invoice_date.slice(0, 7);
    purchasesByMonth.set(
      ym,
      (purchasesByMonth.get(ym) ?? 0) + (Number(r.amount_total_mxn_resolved) || 0)
    );
  }

  // Build monthly trend (last 12 closed months) with rolling 12m flows
  const monthlyTrend: CashConversionCycleSnapshot["monthlyTrend"] = [];
  const closedMonths = snapshots.slice(-13, -1); // exclude current incomplete month
  for (const snap of closedMonths) {
    // Rolling 12m of revenue/cogs/purchases ending at this month
    const idx = snapshots.findIndex((s) => s.period === snap.period);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 11);
    const window = snapshots.slice(start, idx + 1);
    const revenueRolling = window.reduce((s, w) => s + w.revenueMonth, 0);
    const cogsRolling = window.reduce((s, w) => s + w.cogsMonth, 0);
    let purchasesRolling = 0;
    for (const w of window) {
      purchasesRolling += purchasesByMonth.get(w.period) ?? 0;
    }
    const dailyRev = revenueRolling / 365;
    const dailyCogs = cogsRolling / 365;
    const dailyPurchases = purchasesRolling / 365;
    const dso = safeDays(snap.ar, dailyRev);
    const dio = safeDays(snap.inv, dailyCogs);
    const dpo = safeDays(snap.ap, dailyPurchases);
    monthlyTrend.push({
      period: snap.period,
      arMxn: Math.round(snap.ar),
      inventoryMxn: Math.round(snap.inv),
      apMxn: Math.round(snap.ap),
      revenueRolling12m: Math.round(revenueRolling),
      cogsRolling12m: Math.round(cogsRolling),
      purchasesRolling12m: Math.round(purchasesRolling),
      dso,
      dio,
      dpo,
      ccc: Math.round((dso + dio - dpo) * 10) / 10,
    });
  }

  // Current snapshot from latest values
  const latest = snapshots[snapshots.length - 1] ?? {
    ar: 0,
    inv: 0,
    ap: 0,
    revenueMonth: 0,
    cogsMonth: 0,
    period: todayIso.slice(0, 7),
  };
  const last12 = snapshots.slice(-12);
  const revenue12m = last12.reduce((s, w) => s + w.revenueMonth, 0);
  const cogs12m = last12.reduce((s, w) => s + w.cogsMonth, 0);
  let purchases12m = 0;
  for (const w of last12) purchases12m += purchasesByMonth.get(w.period) ?? 0;

  const dso = safeDays(latest.ar, revenue12m / 365);
  const dio = safeDays(latest.inv, cogs12m / 365);
  const dpo = safeDays(latest.ap, purchases12m / 365);
  const ccc = Math.round((dso + dio - dpo) * 10) / 10;
  const dailyRev = revenue12m / 365;
  const workingCapitalTied = Math.round(ccc * dailyRev);

  return {
    asOfDate: todayIso,
    arOpenMxn: Math.round(latest.ar),
    inventoryMxn: Math.round(latest.inv),
    apOpenMxn: Math.round(latest.ap),
    revenue12mMxn: Math.round(revenue12m),
    cogs12mMxn: Math.round(cogs12m),
    purchases12mMxn: Math.round(purchases12m),
    dso,
    dio,
    dpo,
    ccc,
    benchmark: { dso: 60, dio: 90, dpo: 45, ccc: 105 }, // textil mexicano típico
    monthlyTrend,
    workingCapitalTiedMxn: workingCapitalTied,
  };
}

export const getCashConversionCycle = unstable_cache(
  _getCashConversionCycleRaw,
  ["sp13-finanzas-ccc-v1"],
  { revalidate: 3600, tags: ["finanzas"] }
);
