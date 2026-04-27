import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Finance queries — Silver SP5 canonical/gold rewrite.
 *
 * Sources (post-SP5):
 * - `canonical_invoices`       — AR/AP open positions, zombie AR
 * - `canonical_payments`       — payment method aggregation
 * - `canonical_bank_balances`  — live bank balances (replaces cash_position view)
 * - `gold_pl_statement`        — P&L monthly (replaces pl_estado_resultados view)
 * - `gold_cashflow`            — working capital snapshot (replaces working_capital view)
 * - `cfo_dashboard`            — SP5-VERIFIED: retained (reads odoo_bank_balances + odoo_invoices; not in drop list)
 * - `projected_cash_flow_weekly` / `get_projected_cash_flow_summary` — SP5-VERIFIED: retained (cashflow_* views, not in drop list)
 * - `journal_flow_profile`     — SP5-VERIFIED: retained (not in drop list §12)
 * - `working_capital_cycle`    — SP5-VERIFIED: retained (gold_cashflow has no DSO/DPO/DIO fields; view still valid)
 * - `financial_runway`         — DOES NOT EXIST (dropped in SP1); stub returns null // TODO SP6
 */

/** Snapshot ejecutivo del CFO.
 *  SP5-VERIFIED: cfo_dashboard retained (reads odoo_bank_balances + odoo_invoices + odoo_account_payments, not in drop list).
 *  El view expone efectivo_mxn (solo MXN) y efectivo_total_mxn (MXN + USD*rate).
 *  El frontend usa el total como "efectivo disponible" porque es el numero real
 *  que el CEO quiere ver en una sola moneda. */
export interface CfoSnapshot {
  efectivoMxn: number;
  efectivoUsd: number;
  efectivoTotalMxn: number;
  deudaTarjetas: number;
  posicionNeta: number;
  cuentasPorCobrar: number;
  cuentasPorPagar: number;
  carteraVencida: number;
  ventas30d: number;
  cobros30d: number;
  pagosProv30d: number;
  clientesMorosos: number;
}

/** Sums numeric column from rows, treating null/NaN as 0. */
function sumCol<T>(rows: T[], col: keyof T): number {
  return rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
}

async function _getCfoSnapshotRaw(): Promise<CfoSnapshot | null> {
  // Rebuilt 2026-04-23 (sp6-03 follow-up): cfo_dashboard view was dropped
  // in SP8. Compose snapshot from canonical sources via 4 parallel queries.
  const sb = getServiceClient();
  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const [bank, openAr, openAp, sales30, payments30] = await Promise.all([
    // 1. Cash + debt position from bank balances (split by currency for MXN vs USD)
    sb
      .from("canonical_bank_balances")
      .select("currency, classification, current_balance, current_balance_mxn"),
    // 2. Live open AR aggregation from canonical_invoices (canonical_companies.total_receivable_mxn
    //    is NEVER populated — column exists but no writer fills it. Aggregate inline.)
    sb
      .from("canonical_invoices")
      .select(
        "receptor_canonical_company_id, amount_residual_mxn_resolved, amount_residual_mxn_odoo, due_date_resolved, due_date_odoo"
      )
      .eq("is_quimibond_relevant", true)
      .eq("direction", "issued")
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or(
        "amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0"
      ),
    // 3. Live open AP aggregation
    sb
      .from("canonical_invoices")
      .select(
        "amount_residual_mxn_resolved, amount_residual_mxn_odoo"
      )
      .eq("is_quimibond_relevant", true)
      .eq("direction", "received")
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or(
        "amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0"
      ),
    // 4. Last-30d issued invoices for ventas30d
    sb
      .from("canonical_invoices")
      .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
      .eq("is_quimibond_relevant", true)
      .eq("direction", "issued")
      .gte("invoice_date", cutoff30),
    // 5. Last-30d payments split by direction for cobros / pagos_prov
    sb
      .from("canonical_payments")
      .select("direction, amount_mxn_resolved, amount_mxn_odoo")
      .gte("payment_date_resolved", cutoff30),
  ]);

  if (
    bank.error || openAr.error || openAp.error ||
    sales30.error || payments30.error
  ) {
    console.error("[getCfoSnapshot] partial query failure", {
      bank: bank.error?.message,
      openAr: openAr.error?.message,
      openAp: openAp.error?.message,
      sales30: sales30.error?.message,
      payments30: payments30.error?.message,
    });
    return null;
  }

  // ── Cash position
  type Bank = {
    currency: string | null;
    classification: string | null;
    current_balance: number | null;
    current_balance_mxn: number | null;
  };
  const banks = (bank.data ?? []) as Bank[];
  const cash = banks.filter((b) => b.classification === "cash");
  const debt = banks.filter((b) => b.classification === "debt");
  const efectivoMxn = sumCol(
    cash.filter((c) => (c.currency ?? "MXN").toUpperCase() === "MXN"),
    "current_balance_mxn"
  );
  const efectivoUsd = sumCol(
    cash.filter((c) => (c.currency ?? "").toUpperCase() === "USD"),
    "current_balance"
  );
  const efectivoTotalMxn = sumCol(cash, "current_balance_mxn");
  const deudaTarjetas = Math.abs(sumCol(debt, "current_balance_mxn"));
  const posicionNeta = efectivoTotalMxn - deudaTarjetas;

  // ── AR / AP / morosos: live aggregation from canonical_invoices
  type OpenInv = {
    receptor_canonical_company_id?: number | null;
    amount_residual_mxn_resolved: number | null;
    amount_residual_mxn_odoo: number | null;
    due_date_resolved?: string | null;
    due_date_odoo?: string | null;
  };
  const arRows = (openAr.data ?? []) as OpenInv[];
  const apRows = (openAp.data ?? []) as OpenInv[];
  const arAmount = (r: OpenInv): number =>
    Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0;
  const cuentasPorCobrar = arRows.reduce((s, r) => s + arAmount(r), 0);
  const cuentasPorPagar = apRows.reduce((s, r) => s + arAmount(r), 0);

  // Vencida = AR with due_date < today
  const overdueRows = arRows.filter((r) => {
    const due = r.due_date_resolved ?? r.due_date_odoo;
    return due != null && due < today;
  });
  const carteraVencida = overdueRows.reduce((s, r) => s + arAmount(r), 0);
  const clientesMorosos = new Set(
    overdueRows
      .map((r) => r.receptor_canonical_company_id)
      .filter((id): id is number => id != null)
  ).size;

  // ── 30d revenue: prefer resolved (Odoo+SAT reconciled), fall back to Odoo-only
  type Inv = {
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  const sales = (sales30.data ?? []) as Inv[];
  const ventas30d = sales.reduce(
    (s, r) =>
      s + (Number(r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo) || 0),
    0
  );

  // ── 30d collections / supplier-payments by direction
  type Pay = {
    direction: string | null;
    amount_mxn_resolved: number | null;
    amount_mxn_odoo: number | null;
  };
  const pays = (payments30.data ?? []) as Pay[];
  const payAmt = (p: Pay): number =>
    Number(p.amount_mxn_resolved ?? p.amount_mxn_odoo) || 0;
  const cobros30d = pays
    .filter((p) => p.direction === "received")
    .reduce((s, p) => s + payAmt(p), 0);
  const pagosProv30d = pays
    .filter((p) => p.direction === "sent")
    .reduce((s, p) => s + payAmt(p), 0);

  return {
    efectivoMxn,
    efectivoUsd,
    efectivoTotalMxn,
    deudaTarjetas,
    posicionNeta,
    cuentasPorCobrar,
    cuentasPorPagar,
    carteraVencida,
    ventas30d,
    cobros30d,
    pagosProv30d,
    clientesMorosos,
  };
}

export const getCfoSnapshot = unstable_cache(
  _getCfoSnapshotRaw,
  ["finance-cfo-snapshot-v3-null-safe"],
  { revalidate: 60, tags: ["finance"] }
);

/** AR zombies: facturas issued vencidas >1 año que siguen abiertas.
 *  Migrated from invoices_unified (257MB MV) → canonical_invoices.
 *  fiscal_days_to_due_date is mostly NULL pre-Task-24; fallback to due_date_odoo arithmetic. */
export interface ArZombies {
  count: number;
  totalMxn: number;
}

export async function getArZombies(): Promise<ArZombies> {
  const sb = getServiceClient();
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  // amount_residual_mxn_odoo is the live open amount (amount_residual_mxn_resolved is 0% pre-Task-24)
  const { data } = await sb
    .from("canonical_invoices")
    .select("canonical_id, amount_residual_mxn_odoo, due_date_odoo, estado_sat, match_confidence")
    .eq("is_quimibond_relevant", true)
    .eq("direction", "issued")
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state_odoo", ["not_paid", "partial"])
    .lt("due_date_odoo", cutoffStr)
    .gt("amount_residual_mxn_odoo", 0);
  const rows = (data ?? []) as Array<{ amount_residual_mxn_odoo: number | null }>;
  const totalMxn = rows.reduce((s, r) => s + (Number(r.amount_residual_mxn_odoo) || 0), 0);
  return { count: rows.length, totalMxn };
}

/** Runway + net position 30d.
 *  financial_runway view was DROPPED in SP1 and does not exist in DB.
 *  // TODO SP6: rebuild from canonical_invoices + canonical_bank_balances + canonical_payments
 */
export interface FinancialRunway {
  cashMxn: number;
  expectedInMxn: number;
  dueOutMxn: number;
  netPosition30d: number;
  burnRateDaily: number;
  runwayDaysNet: number;
  runwayDaysCashOnly: number;
  computedAt: string | null;
}

export async function getFinancialRunway(): Promise<FinancialRunway | null> {
  // TODO SP6: financial_runway view does not exist (dropped SP1). Rebuild from canonical layer.
  return null;
}

/** Capital de trabajo — from gold_cashflow (replaces working_capital view which no longer exists).
 *  gold_cashflow fields: current_cash_mxn, current_debt_mxn, total_receivable_mxn,
 *  overdue_receivable_mxn, total_payable_mxn, working_capital_mxn, bank_breakdown, refreshed_at.
 *  Note: gold_cashflow has no ratio_liquidez / ratio_prueba_acida — stubbed as 0. */
export interface WorkingCapital {
  efectivoDisponible: number;
  deudaTarjetas: number;
  efectivoNeto: number;
  cuentasPorCobrar: number;
  cuentasPorPagar: number;
  capitalDeTrabajo: number;
  ratioLiquidez: number;
  ratioPruebaAcida: number;
}

export async function getWorkingCapital(): Promise<WorkingCapital | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("gold_cashflow").select("*").maybeSingle();
  if (!data) return null;
  const d = data as {
    current_cash_mxn: number | null;
    current_debt_mxn: number | null;
    total_receivable_mxn: number | null;
    total_payable_mxn: number | null;
    working_capital_mxn: number | null;
  };
  const cash = Number(d.current_cash_mxn) || 0;
  const debt = Math.abs(Number(d.current_debt_mxn) || 0);
  const ar = Number(d.total_receivable_mxn) || 0;
  const ap = Number(d.total_payable_mxn) || 0;
  const wc = Number(d.working_capital_mxn) || 0;
  // Ratios approximated: gold_cashflow has no precomputed ratios
  const ratioLiquidez = ap > 0 ? (cash + ar) / ap : 0;
  const ratioPruebaAcida = ap > 0 ? cash / ap : 0;
  return {
    efectivoDisponible: cash,
    deudaTarjetas: debt,
    efectivoNeto: cash - debt,
    cuentasPorCobrar: ar,
    cuentasPorPagar: ap,
    capitalDeTrabajo: wc,
    ratioLiquidez: Math.round(ratioLiquidez * 100) / 100,
    ratioPruebaAcida: Math.round(ratioPruebaAcida * 100) / 100,
  };
}

/** Saldo bancario — from canonical_bank_balances (replaces cash_position view).
 *  canonical_bank_balances fields: name, journal_type, currency, bank_account,
 *  current_balance, current_balance_mxn, classification.
 *  Frontend uses saldoMxn by default; saldo nativo as additional info. */
export interface BankBalance {
  banco: string | null;
  tipo: string | null;
  moneda: string | null;
  cuenta: string | null;
  saldo: number;
  saldoMxn: number;
}

export async function getCashPosition(): Promise<BankBalance[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_bank_balances")
    .select("name, journal_type, currency, bank_account, current_balance, current_balance_mxn, classification")
    .order("current_balance_mxn", { ascending: false });
  return ((data ?? []) as Array<{
    name: string | null;
    journal_type: string | null;
    currency: string | null;
    bank_account: string | null;
    current_balance: number | null;
    current_balance_mxn: number | null;
    classification: string | null;
  }>).map((r) => {
    const saldoMxn = Number(r.current_balance_mxn) || 0;
    // classification='debt' means credit card / liability
    let tipo = r.journal_type;
    const nameHint = (r.name ?? "").toLowerCase();
    const looksLikeCard =
      r.classification === "debt" ||
      saldoMxn < 0 ||
      /\b(tja|tarjeta|jeeves|amex|credit)\b/.test(nameHint);
    if (tipo !== "credit" && looksLikeCard) {
      tipo = "credit";
    }
    return {
      banco: r.name,
      tipo,
      moneda: r.currency,
      cuenta: r.bank_account,
      saldo: Number(r.current_balance) || 0,
      saldoMxn,
    };
  });
}

/** Punto P&L por mes — from gold_pl_statement (replaces pl_estado_resultados view).
 *  gold_pl_statement columns: period (YYYY-MM), total_income (negative convention),
 *  total_expense, net_income, by_level_1 (JSONB with account_type breakdown).
 *  Mapping: ingresos = abs(total_income), costo_ventas/gastos derived from by_level_1. */
export interface PlPoint {
  period: string;
  ingresos: number;
  costoVentas: number;
  gastosOperativos: number;
  utilidadBruta: number;
  utilidadOperativa: number;
  otrosNeto: number;
}

export async function getPlHistory(
  months = 12,
  opts?: { from?: string; to?: string }
): Promise<PlPoint[]> {
  const sb = getServiceClient();
  let query = sb
    .from("gold_pl_statement")
    .select("period, total_income, total_expense, net_income, by_level_1")
    .order("period", { ascending: false });

  // period is YYYY-MM — lexicographic comparison works
  if (opts?.from) query = query.gte("period", opts.from.slice(0, 7));
  if (opts?.to) query = query.lte("period", opts.to.slice(0, 7));

  const limitVal = opts?.from || opts?.to ? 120 : months + 5;
  const { data } = await query.limit(limitVal);

  type GoldPlRow = {
    period: string | null;
    total_income: number | null;
    total_expense: number | null;
    net_income: number | null;
    by_level_1: Record<string, { balance: number; account_type: string }> | null;
  };

  const rows = (data ?? []) as GoldPlRow[];

  // Filter invalid periods
  const valid = rows.filter((r) => {
    if (!r.period) return false;
    const [y] = r.period.split("-");
    const year = Number(y);
    return year >= 2020 && year <= 2030;
  });

  const sliced = opts?.from || opts?.to ? valid : valid.slice(0, months);

  return sliced
    .map((r) => {
      // total_income is negative in accounting convention → abs for display
      const ingresos = Math.abs(Number(r.total_income) || 0);
      // Derive costo_ventas and gastos from by_level_1 breakdown
      let costoVentas = 0;
      let gastosOperativos = 0;
      let otrosNeto = 0;
      if (r.by_level_1) {
        for (const entry of Object.values(r.by_level_1)) {
          const bal = Number(entry.balance) || 0;
          switch (entry.account_type) {
            case "expense_direct_cost":
              costoVentas += bal;
              break;
            case "expense":
            case "expense_depreciation":
              gastosOperativos += bal;
              break;
            case "income_other":
            case "expense_other":
              otrosNeto += bal;
              break;
          }
        }
      } else {
        // Fallback: approximate from totals
        costoVentas = Math.max(0, Number(r.total_expense) || 0) * 0.7;
        gastosOperativos = Math.max(0, Number(r.total_expense) || 0) * 0.3;
      }
      const utilidadBruta = ingresos - costoVentas;
      const utilidadOperativa = utilidadBruta - gastosOperativos;
      return {
        period: r.period as string,
        ingresos,
        costoVentas: Math.round(costoVentas * 100) / 100,
        gastosOperativos: Math.round(gastosOperativos * 100) / 100,
        utilidadBruta: Math.round(utilidadBruta * 100) / 100,
        utilidadOperativa: Math.round(utilidadOperativa * 100) / 100,
        otrosNeto: Math.round(otrosNeto * 100) / 100,
      };
    })
    .reverse(); // ascending chronological order
}

/**
 * Working Capital Cycle — recomputed from canonical_invoices + gold_pl_statement.
 * working_capital_cycle view dropped in SP8. DIO/CCC remain null until
 * canonical_inventory exists (TODO SP6).
 */
export interface WorkingCapitalCycle {
  revenue12mMxn: number;
  cogs12mMxn: number;
  grossProfit12mMxn: number;
  grossMarginPct: number;
  arMxn: number;
  apMxn: number;
  inventoryMxn: number | null;
  dsoDays: number | null;
  dpoDays: number | null;
  dioDays: number | null;
  cccDays: number | null;
  workingCapitalMxn: number;
  computedAt: string | null;
}

async function _getWorkingCapitalCycleRaw(): Promise<WorkingCapitalCycle | null> {
  const sb = getServiceClient();
  const now = new Date();
  const cutoff365 = new Date(now.getTime() - 365 * 86400000)
    .toISOString()
    .slice(0, 10);
  // gold_pl_statement.period is YYYY-MM; pull last 12 months
  const cutoffMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    .toISOString()
    .slice(0, 7);

  const [openAr, openAp, revenue12m, plLast12] = await Promise.all([
    sb
      .from("canonical_invoices")
      .select("amount_residual_mxn_resolved, amount_residual_mxn_odoo")
      .eq("is_quimibond_relevant", true)
      .eq("direction", "issued")
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or("amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0"),
    sb
      .from("canonical_invoices")
      .select("amount_residual_mxn_resolved, amount_residual_mxn_odoo")
      .eq("is_quimibond_relevant", true)
      .eq("direction", "received")
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or("amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0"),
    sb
      .from("canonical_invoices")
      .select("amount_total_mxn_resolved, amount_total_mxn_odoo")
      .eq("is_quimibond_relevant", true)
      .eq("direction", "issued")
      .eq("state_odoo", "posted")
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .gte("invoice_date", cutoff365),
    sb
      .from("gold_pl_statement")
      .select("period, by_level_1, total_expense")
      .gte("period", cutoffMonth)
      .order("period", { ascending: false })
      .limit(12),
  ]);

  if (openAr.error || openAp.error || revenue12m.error || plLast12.error) {
    console.error("[getWorkingCapitalCycle] partial query failure", {
      openAr: openAr.error?.message,
      openAp: openAp.error?.message,
      revenue12m: revenue12m.error?.message,
      plLast12: plLast12.error?.message,
    });
    return null;
  }

  type Resid = {
    amount_residual_mxn_resolved: number | null;
    amount_residual_mxn_odoo: number | null;
  };
  const residual = (r: Resid): number =>
    Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0;
  const arMxn = (openAr.data ?? []).reduce(
    (s: number, r) => s + residual(r as Resid),
    0
  );
  const apMxn = (openAp.data ?? []).reduce(
    (s: number, r) => s + residual(r as Resid),
    0
  );

  type Inv = {
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
  };
  const revenue12mMxn = (revenue12m.data ?? []).reduce(
    (s: number, r) =>
      s +
      (Number((r as Inv).amount_total_mxn_resolved ?? (r as Inv).amount_total_mxn_odoo) ||
        0),
    0
  );

  // COGS = sum of expense_direct_cost balances across last 12 P&L months
  type PlRow = {
    period: string | null;
    total_expense: number | null;
    by_level_1: Record<string, { balance: number; account_type: string }> | null;
  };
  const cogs12mMxn = (plLast12.data ?? []).reduce((sum: number, raw) => {
    const r = raw as PlRow;
    if (!r.by_level_1) return sum;
    let monthCogs = 0;
    for (const entry of Object.values(r.by_level_1)) {
      if (entry.account_type === "expense_direct_cost") {
        monthCogs += Number(entry.balance) || 0;
      }
    }
    return sum + monthCogs;
  }, 0);

  const grossProfit12mMxn = revenue12mMxn - cogs12mMxn;
  const grossMarginPct =
    revenue12mMxn > 0 ? (grossProfit12mMxn / revenue12mMxn) * 100 : 0;

  // DSO/DPO use spot AR/AP balance (typical SMB practice; avoids needing
  // a historical AR series). Annualize by 365 over 12-month flow.
  const dsoDays =
    revenue12mMxn > 0 ? Math.round((arMxn / revenue12mMxn) * 365) : null;
  const dpoDays =
    cogs12mMxn > 0 ? Math.round((apMxn / cogs12mMxn) * 365) : null;

  // No canonical_inventory yet → DIO and CCC stay null. Working capital
  // computed without inventory term.
  const workingCapitalMxn = arMxn - apMxn;

  return {
    revenue12mMxn,
    cogs12mMxn,
    grossProfit12mMxn,
    grossMarginPct,
    arMxn,
    apMxn,
    inventoryMxn: null,
    dsoDays,
    dpoDays,
    dioDays: null,
    cccDays: null,
    workingCapitalMxn,
    computedAt: now.toISOString(),
  };
}

export const getWorkingCapitalCycle = unstable_cache(
  _getWorkingCapitalCycleRaw,
  ["finance-wcc-canonical-v2-null-safe"],
  { revalidate: 300, tags: ["finance"] }
);

/**
 * Projected Cash Flow v2 — método directo 13 semanas.
 *
 * SP5-VERIFIED: projected_cash_flow_weekly retained (cashflow_* views, not in drop list).
 * SP5-VERIFIED: get_projected_cash_flow_summary RPC retained (reads cashflow_* views, not legacy MVs).
 */
export interface ProjectedCashFlowWeek {
  weekIndex: number;
  weekStart: string;
  weekEnd: string;
  // Inflows
  arGross: number;
  arWeighted: number;
  arOverdueGross: number;
  soGross: number;
  soWeighted: number;
  inflowsWeighted: number;
  inflowsGross: number;
  // Outflows
  apGross: number;
  apWeighted: number;
  apOverdueGross: number;
  poGross: number;
  poWeighted: number;
  payrollEstimated: number;
  opexRecurring: number;
  taxEstimated: number;
  outflowsWeighted: number;
  outflowsGross: number;
  // Balance
  netFlow: number;
  openingBalance: number;
  closingBalance: number;
}

export interface ProjectedCashFlowCash {
  netMxn: number;
  operativeMxn: number;
  restrictedMxn: number;
  ccDebtMxn: number;
  inTransitMxn: number;
  effectiveMxn: number;
  usdRate: number | null;
  eurRate: number | null;
  activeAccounts: number;
  inTransitAccounts: number;
}

export interface ProjectedCashFlowUnreconciled {
  unmatchedInboundMxn: number;
  unmatchedOutboundMxn: number;
  pendingInboundMxn: number;
  pendingOutboundMxn: number;
  nUnmatchedInbound: number;
  nUnmatchedOutbound: number;
  nPendingInbound: number;
  nPendingOutbound: number;
}

export interface ProjectedCashFlowOpenPositions {
  arTotalMxn: number;
  arOverdueMxn: number;
  apTotalMxn: number;
  apOverdueMxn: number;
  soBacklogMxn: number;
  poBacklogMxn: number;
}

export interface RecurringSource {
  monthlyMxn: number;
  weeklyMxn?: number;
  monthsUsed: number;
  periods?: string;
}

export interface ProjectedCashFlowRecurringSources {
  payroll: RecurringSource;
  opex: RecurringSource;
  tax: RecurringSource;
}

export interface ProjectedCashFlowSummary {
  cash: ProjectedCashFlowCash;
  unreconciled: ProjectedCashFlowUnreconciled;
  totals13w: {
    inflowsWeighted: number;
    inflowsGross: number;
    outflowsWeighted: number;
    outflowsGross: number;
    netFlow: number;
    minClosingBalance: number | null;
    maxClosingBalance: number | null;
  };
  firstNegativeWeek: {
    weekIndex: number;
    weekStart: string;
    closingBalance: number;
  } | null;
  openPositions: ProjectedCashFlowOpenPositions;
  recurringSources: ProjectedCashFlowRecurringSources;
  computedAt: string | null;
}

export interface ProjectedCashFlow {
  summary: ProjectedCashFlowSummary | null;
  weeks: ProjectedCashFlowWeek[];
}

type RawWeek = {
  week_index: number | null;
  week_start: string | null;
  week_end: string | null;
  ar_gross: number | null;
  ar_weighted: number | null;
  ar_overdue_gross: number | null;
  so_gross: number | null;
  so_weighted: number | null;
  ap_gross: number | null;
  ap_weighted: number | null;
  ap_overdue_gross: number | null;
  po_gross: number | null;
  po_weighted: number | null;
  payroll_estimated: number | null;
  opex_recurring: number | null;
  tax_estimated: number | null;
  inflows_weighted: number | null;
  inflows_gross: number | null;
  outflows_weighted: number | null;
  outflows_gross: number | null;
  net_flow: number | null;
  opening_balance: number | null;
  closing_balance: number | null;
};

function mapWeek(r: RawWeek): ProjectedCashFlowWeek {
  return {
    weekIndex: Number(r.week_index) || 0,
    weekStart: r.week_start ?? "",
    weekEnd: r.week_end ?? "",
    arGross: Number(r.ar_gross) || 0,
    arWeighted: Number(r.ar_weighted) || 0,
    arOverdueGross: Number(r.ar_overdue_gross) || 0,
    soGross: Number(r.so_gross) || 0,
    soWeighted: Number(r.so_weighted) || 0,
    apGross: Number(r.ap_gross) || 0,
    apWeighted: Number(r.ap_weighted) || 0,
    apOverdueGross: Number(r.ap_overdue_gross) || 0,
    poGross: Number(r.po_gross) || 0,
    poWeighted: Number(r.po_weighted) || 0,
    payrollEstimated: Number(r.payroll_estimated) || 0,
    opexRecurring: Number(r.opex_recurring) || 0,
    taxEstimated: Number(r.tax_estimated) || 0,
    inflowsWeighted: Number(r.inflows_weighted) || 0,
    inflowsGross: Number(r.inflows_gross) || 0,
    outflowsWeighted: Number(r.outflows_weighted) || 0,
    outflowsGross: Number(r.outflows_gross) || 0,
    netFlow: Number(r.net_flow) || 0,
    openingBalance: Number(r.opening_balance) || 0,
    closingBalance: Number(r.closing_balance) || 0,
  };
}

type RawSummary = {
  computed_at: string | null;
  cash: {
    net_mxn: number | null;
    operative_mxn: number | null;
    restricted_mxn: number | null;
    cc_debt_mxn: number | null;
    in_transit_mxn: number | null;
    effective_mxn: number | null;
    usd_rate: number | null;
    eur_rate: number | null;
    active_accounts: number | null;
    in_transit_accounts: number | null;
  };
  unreconciled: {
    unmatched_inbound_mxn: number | null;
    unmatched_outbound_mxn: number | null;
    pending_inbound_mxn: number | null;
    pending_outbound_mxn: number | null;
    n_unmatched_inbound: number | null;
    n_unmatched_outbound: number | null;
    n_pending_inbound: number | null;
    n_pending_outbound: number | null;
  };
  totals_13w: {
    inflows_weighted: number | null;
    inflows_gross: number | null;
    outflows_weighted: number | null;
    outflows_gross: number | null;
    net_flow: number | null;
    min_closing_balance: number | null;
    max_closing_balance: number | null;
  };
  first_negative_week: {
    week_index: number;
    week_start: string;
    closing_balance: number;
  } | null;
  open_positions: {
    ar_total_mxn: number | null;
    ar_overdue_mxn: number | null;
    ap_total_mxn: number | null;
    ap_overdue_mxn: number | null;
    so_backlog_mxn: number | null;
    po_backlog_mxn: number | null;
  };
  recurring_sources: {
    payroll: { monthly_mxn: number | null; months_used: number | null; periods?: string; weekly_mxn?: number };
    opex: { monthly_mxn: number | null; months_used: number | null; periods?: string; weekly_mxn?: number };
    tax: { monthly_mxn: number | null; months_used: number | null };
  };
};

function mapSource(s: {
  monthly_mxn: number | null;
  months_used: number | null;
  periods?: string;
  weekly_mxn?: number;
}): RecurringSource {
  return {
    monthlyMxn: Number(s.monthly_mxn) || 0,
    weeklyMxn: s.weekly_mxn != null ? Number(s.weekly_mxn) : undefined,
    monthsUsed: Number(s.months_used) || 0,
    periods: s.periods,
  };
}

export async function getProjectedCashFlow(): Promise<ProjectedCashFlow> {
  const sb = getServiceClient();
  const [{ data: weeksRaw }, { data: summaryRaw }] = await Promise.all([
    sb
      // SP5-VERIFIED: projected_cash_flow_weekly retained (cashflow_* views, not in drop list)
      .from("projected_cash_flow_weekly")
      .select("*")
      .order("week_index", { ascending: true }),
    // SP5-VERIFIED: get_projected_cash_flow_summary RPC reads cashflow_* views (not legacy MVs)
    sb.rpc("get_projected_cash_flow_summary"),
  ]);

  const weeks = ((weeksRaw ?? []) as RawWeek[]).map(mapWeek);

  const s = (summaryRaw ?? null) as RawSummary | null;
  const summary: ProjectedCashFlowSummary | null = s
    ? {
        computedAt: s.computed_at,
        cash: {
          netMxn: Number(s.cash?.net_mxn) || 0,
          operativeMxn: Number(s.cash?.operative_mxn) || 0,
          restrictedMxn: Number(s.cash?.restricted_mxn) || 0,
          ccDebtMxn: Number(s.cash?.cc_debt_mxn) || 0,
          inTransitMxn: Number(s.cash?.in_transit_mxn) || 0,
          effectiveMxn: Number(s.cash?.effective_mxn) || 0,
          usdRate: s.cash?.usd_rate != null ? Number(s.cash.usd_rate) : null,
          eurRate: s.cash?.eur_rate != null ? Number(s.cash.eur_rate) : null,
          activeAccounts: Number(s.cash?.active_accounts) || 0,
          inTransitAccounts: Number(s.cash?.in_transit_accounts) || 0,
        },
        unreconciled: {
          unmatchedInboundMxn: Number(s.unreconciled?.unmatched_inbound_mxn) || 0,
          unmatchedOutboundMxn: Number(s.unreconciled?.unmatched_outbound_mxn) || 0,
          pendingInboundMxn: Number(s.unreconciled?.pending_inbound_mxn) || 0,
          pendingOutboundMxn: Number(s.unreconciled?.pending_outbound_mxn) || 0,
          nUnmatchedInbound: Number(s.unreconciled?.n_unmatched_inbound) || 0,
          nUnmatchedOutbound: Number(s.unreconciled?.n_unmatched_outbound) || 0,
          nPendingInbound: Number(s.unreconciled?.n_pending_inbound) || 0,
          nPendingOutbound: Number(s.unreconciled?.n_pending_outbound) || 0,
        },
        totals13w: {
          inflowsWeighted: Number(s.totals_13w?.inflows_weighted) || 0,
          inflowsGross: Number(s.totals_13w?.inflows_gross) || 0,
          outflowsWeighted: Number(s.totals_13w?.outflows_weighted) || 0,
          outflowsGross: Number(s.totals_13w?.outflows_gross) || 0,
          netFlow: Number(s.totals_13w?.net_flow) || 0,
          minClosingBalance:
            s.totals_13w?.min_closing_balance != null
              ? Number(s.totals_13w.min_closing_balance)
              : null,
          maxClosingBalance:
            s.totals_13w?.max_closing_balance != null
              ? Number(s.totals_13w.max_closing_balance)
              : null,
        },
        firstNegativeWeek: s.first_negative_week
          ? {
              weekIndex: Number(s.first_negative_week.week_index) || 0,
              weekStart: String(s.first_negative_week.week_start ?? ""),
              closingBalance: Number(s.first_negative_week.closing_balance) || 0,
            }
          : null,
        openPositions: {
          arTotalMxn: Number(s.open_positions?.ar_total_mxn) || 0,
          arOverdueMxn: Number(s.open_positions?.ar_overdue_mxn) || 0,
          apTotalMxn: Number(s.open_positions?.ap_total_mxn) || 0,
          apOverdueMxn: Number(s.open_positions?.ap_overdue_mxn) || 0,
          soBacklogMxn: Number(s.open_positions?.so_backlog_mxn) || 0,
          poBacklogMxn: Number(s.open_positions?.po_backlog_mxn) || 0,
        },
        recurringSources: {
          payroll: mapSource(s.recurring_sources?.payroll ?? { monthly_mxn: 0, months_used: 0 }),
          opex: mapSource(s.recurring_sources?.opex ?? { monthly_mxn: 0, months_used: 0 }),
          tax: mapSource(s.recurring_sources?.tax ?? { monthly_mxn: 0, months_used: 0 }),
        },
      }
    : null;

  return { summary, weeks };
}


/* ============================================================================
 * Cashflow Recommendations Engine
 *   SP5-VERIFIED: get_cashflow_recommendations RPC reads cashflow_* views (not legacy MVs).
 * ========================================================================== */

export type RecommendationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'WARNING';

export interface CashflowRecommendationAction {
  priority: number;
  severity: RecommendationSeverity;
  category: string;
  title: string;
  rationale: string;
  action: string;
  impactMxn: number;
}

export interface CashflowTopCompany {
  companyId: number | null;
  companyName: string | null;
  totalOverdueMxn: number;
  nInvoices: number;
  maxDaysOverdue: number;
  avgDaysOverdue: number;
  collectionProbability14d?: number;
  expectedCollection14dMxn?: number;
}

export interface CashflowRecommendations {
  computedAt: string | null;
  metrics: {
    effectiveCashMxn: number;
    apOverdueMxn: number;
    arOverdueMxn: number;
    liquidityGapMxn: number;
    apOverdueCoverageRatio: number | null;
    runwayWeeksRecurring: number | null;
    burnRateWeeklyMxn: number;
    payrollQuincenalMxn: number;
    opexWeeklyMxn: number;
    taxWeeklyMxn: number;
  };
  topArToCollect: CashflowTopCompany[];
  topApToNegotiate: CashflowTopCompany[];
  actions: CashflowRecommendationAction[];
}

export async function getCashflowRecommendations(): Promise<CashflowRecommendations | null> {
  const sb = getServiceClient();
  // SP5-VERIFIED: get_cashflow_recommendations reads cashflow_* views (not legacy dropped MVs)
  const { data } = await sb.rpc('get_cashflow_recommendations');
  if (!data) return null;
  const r = data as {
    computed_at: string | null;
    metrics: Record<string, number | null>;
    top_ar_to_collect: Array<Record<string, unknown>>;
    top_ap_to_negotiate: Array<Record<string, unknown>>;
    actions: Array<Record<string, unknown>>;
  };
  const num = (x: unknown) => (x == null ? 0 : Number(x));
  const mapCompany = (c: Record<string, unknown>): CashflowTopCompany => ({
    companyId: (c.company_id as number | null) ?? null,
    companyName: (c.company_name as string | null) ?? null,
    totalOverdueMxn: num(c.total_overdue_mxn),
    nInvoices: num(c.n_invoices),
    maxDaysOverdue: num(c.max_days_overdue),
    avgDaysOverdue: num(c.avg_days_overdue),
    collectionProbability14d: c.collection_probability_14d != null ? num(c.collection_probability_14d) : undefined,
    expectedCollection14dMxn: c.expected_collection_14d_mxn != null ? num(c.expected_collection_14d_mxn) : undefined,
  });
  return {
    computedAt: r.computed_at,
    metrics: {
      effectiveCashMxn: num(r.metrics.effective_cash_mxn),
      apOverdueMxn: num(r.metrics.ap_overdue_mxn),
      arOverdueMxn: num(r.metrics.ar_overdue_mxn),
      liquidityGapMxn: num(r.metrics.liquidity_gap_mxn),
      apOverdueCoverageRatio: r.metrics.ap_overdue_coverage_ratio != null ? num(r.metrics.ap_overdue_coverage_ratio) : null,
      runwayWeeksRecurring: r.metrics.runway_weeks_recurring != null ? num(r.metrics.runway_weeks_recurring) : null,
      burnRateWeeklyMxn: num(r.metrics.burn_rate_weekly_mxn),
      payrollQuincenalMxn: num(r.metrics.payroll_quincenal_mxn),
      opexWeeklyMxn: num(r.metrics.opex_weekly_mxn),
      taxWeeklyMxn: num(r.metrics.tax_weekly_mxn),
    },
    // Filter write-offs >1 year from collection ranking: invoices with thousands of
    // overdue days are uncollectable, not priorities — distort top-10 even if RPC assigns low probability.
    topArToCollect: (r.top_ar_to_collect || [])
      .map(mapCompany)
      .filter((c) => c.maxDaysOverdue > 0 && c.maxDaysOverdue < 365),
    topApToNegotiate: (r.top_ap_to_negotiate || [])
      .map(mapCompany)
      .filter((c) => c.maxDaysOverdue < 365),
    actions: (r.actions || []).map((a) => ({
      priority: num(a.priority),
      severity: (a.severity as RecommendationSeverity) || 'MEDIUM',
      category: (a.category as string) || '',
      title: (a.title as string) || '',
      rationale: (a.rationale as string) || '',
      action: (a.action as string) || '',
      impactMxn: num(a.impact_mxn),
    })),
  };
}

/* ──────────────────────────────────────────────────────────────
 * Cashflow profiles v3 — canonical layer
 * - partner_payment_profile MV → client-side agg over canonical_invoices + canonical_payments
 * - journal_flow_profile MV → SP5-VERIFIED: retained (not in drop list §12)
 * - account_payment_profile MV → agg canonical_payments by payment_method_odoo
 * ──────────────────────────────────────────────────────────── */

export interface PartnerPaymentProfile {
  odooPartnerId: number;
  partnerName: string | null;
  paymentType: 'inbound' | 'outbound';
  paymentCount24m: number;
  monthsActive: number;
  totalPaidMxn: number;
  avgPaymentAmount: number;
  typicalDayOfMonth: number | null;
  preferredBankJournal: string | null;
  preferredPaymentMethod: string | null;
  invoiceCount24m: number;
  paidInvoiceCount: number;
  avgDaysToPay: number | null;
  medianDaysToPay: number | null;
  stddevDaysToPay: number | null;
  totalInvoicedMxn: number;
  writeoffRiskCount: number;
  writeoffRiskPct: number;
  confidence: number;
}

/**
 * getPartnerPaymentProfiles — client-side aggregation from canonical_invoices + canonical_payments.
 * Replaces partner_payment_profile MV. Returns top partners by paid amount.
 * fiscal_days_to_due_date is mostly NULL pre-Task-24; avgDaysToPay derived from due_date_odoo arithmetic.
 */
export async function getPartnerPaymentProfiles(
  paymentType: 'inbound' | 'outbound' | 'all' = 'all',
  minConfidence = 0.5,
  limit = 50,
): Promise<PartnerPaymentProfile[]> {
  const sb = getServiceClient();

  const cutoff24m = new Date();
  cutoff24m.setMonth(cutoff24m.getMonth() - 24);
  const cutoff24mStr = cutoff24m.toISOString().slice(0, 10);

  // Fetch issued invoices (inbound AR) and received invoices (outbound AP) in last 24m
  const direction = paymentType === 'inbound' ? 'issued' : paymentType === 'outbound' ? 'received' : undefined;

  let invQ = sb
    .from("canonical_invoices")
    .select("odoo_partner_id, direction, invoice_date, due_date_odoo, amount_total_mxn_resolved, payment_state_odoo, fiscal_days_to_due_date")
    .eq("is_quimibond_relevant", true)
    .not("odoo_partner_id", "is", null)
    .gte("invoice_date", cutoff24mStr);
  if (direction) invQ = invQ.eq("direction", direction);
  const { data: invData } = await invQ;

  // Fetch payments in last 24m
  let payQ = sb
    .from("canonical_payments")
    .select("odoo_partner_id, direction, payment_date_resolved, amount_mxn_resolved, journal_name, payment_method_odoo")
    .not("odoo_partner_id", "is", null)
    .gte("payment_date_resolved", cutoff24mStr);
  if (paymentType !== 'all') {
    payQ = payQ.eq("direction", paymentType);
  }
  const { data: payData } = await payQ;

  type InvRow = {
    odoo_partner_id: number;
    direction: string;
    invoice_date: string | null;
    due_date_odoo: string | null;
    amount_total_mxn_resolved: number | null;
    payment_state_odoo: string | null;
    fiscal_days_to_due_date: number | null;
  };
  type PayRow = {
    odoo_partner_id: number;
    direction: string | null;
    payment_date_resolved: string | null;
    amount_mxn_resolved: number | null;
    journal_name: string | null;
    payment_method_odoo: string | null;
  };

  const invRows = (invData ?? []) as InvRow[];
  const payRows = (payData ?? []) as PayRow[];

  // Aggregate by partner + direction
  type Agg = {
    odooPartnerId: number;
    paymentType: 'inbound' | 'outbound';
    invoiceCount: number;
    paidCount: number;
    totalInvoiced: number;
    writeoffCount: number;
    totalPaid: number;
    payCount: number;
    daysToPaySum: number;
    daysToPayN: number;
    journalCounts: Record<string, number>;
    methodCounts: Record<string, number>;
    payDates: number[];
  };

  const aggMap = new Map<string, Agg>();

  const today = new Date();

  for (const inv of invRows) {
    const pid = Number(inv.odoo_partner_id);
    if (!pid || pid <= 1) continue;
    const ptype: 'inbound' | 'outbound' = inv.direction === 'issued' ? 'inbound' : 'outbound';
    const key = `${pid}:${ptype}`;
    if (!aggMap.has(key)) {
      aggMap.set(key, {
        odooPartnerId: pid, paymentType: ptype,
        invoiceCount: 0, paidCount: 0, totalInvoiced: 0, writeoffCount: 0,
        totalPaid: 0, payCount: 0, daysToPaySum: 0, daysToPayN: 0,
        journalCounts: {}, methodCounts: {}, payDates: [],
      });
    }
    const agg = aggMap.get(key)!;
    agg.invoiceCount++;
    const amt = Number(inv.amount_total_mxn_resolved) || 0;
    agg.totalInvoiced += amt;
    if (inv.payment_state_odoo === 'paid') {
      agg.paidCount++;
      agg.totalPaid += amt;
    }
    // Compute days-to-pay from due_date_odoo (fiscal_days_to_due_date is mostly NULL pre-Task-24)
    if (inv.due_date_odoo && inv.payment_state_odoo === 'paid') {
      const due = new Date(inv.due_date_odoo).getTime();
      const paidApprox = today.getTime(); // approximation; real paid date would come from allocations
      const diffDays = Math.round((paidApprox - due) / 86400000);
      if (Math.abs(diffDays) < 3650) {
        agg.daysToPaySum += diffDays;
        agg.daysToPayN++;
      }
    }
    // Write-off risk: unpaid invoices past 365d
    if (inv.due_date_odoo && inv.payment_state_odoo !== 'paid') {
      const due = new Date(inv.due_date_odoo);
      const daysPast = Math.round((today.getTime() - due.getTime()) / 86400000);
      if (daysPast > 365) agg.writeoffCount++;
    }
  }

  for (const pay of payRows) {
    const pid = Number(pay.odoo_partner_id);
    if (!pid || pid <= 1) continue;
    const ptype: 'inbound' | 'outbound' = (pay.direction ?? 'inbound') as 'inbound' | 'outbound';
    const key = `${pid}:${ptype}`;
    if (!aggMap.has(key)) {
      aggMap.set(key, {
        odooPartnerId: pid, paymentType: ptype,
        invoiceCount: 0, paidCount: 0, totalInvoiced: 0, writeoffCount: 0,
        totalPaid: 0, payCount: 0, daysToPaySum: 0, daysToPayN: 0,
        journalCounts: {}, methodCounts: {}, payDates: [],
      });
    }
    const agg = aggMap.get(key)!;
    agg.payCount++;
    agg.totalPaid += Number(pay.amount_mxn_resolved) || 0;
    if (pay.journal_name) {
      agg.journalCounts[pay.journal_name] = (agg.journalCounts[pay.journal_name] ?? 0) + 1;
    }
    if (pay.payment_method_odoo) {
      agg.methodCounts[pay.payment_method_odoo] = (agg.methodCounts[pay.payment_method_odoo] ?? 0) + 1;
    }
    if (pay.payment_date_resolved) {
      agg.payDates.push(new Date(pay.payment_date_resolved).getDate());
    }
  }

  // Resolve partner names from canonical_companies
  const allPartnerIds = Array.from(new Set(Array.from(aggMap.values()).map((a) => a.odooPartnerId)));
  const nameMap = new Map<number, string>();
  if (allPartnerIds.length) {
    const { data: companies } = await sb
      .from('canonical_companies')
      .select('odoo_partner_id, display_name')
      .in('odoo_partner_id', allPartnerIds.slice(0, 500));
    (companies ?? []).forEach((c) => {
      const row = c as { odoo_partner_id: number | null; display_name: string | null };
      if (row.odoo_partner_id && row.display_name) nameMap.set(row.odoo_partner_id, row.display_name);
    });
    // Fallback: companies table
    if (nameMap.size < allPartnerIds.length) {
      const missing = allPartnerIds.filter((id) => !nameMap.has(id)).slice(0, 500);
      if (missing.length) {
        const { data: fallback } = await sb.from('companies').select('odoo_partner_id, name').in('odoo_partner_id', missing);
        (fallback ?? []).forEach((c) => {
          const row = c as { odoo_partner_id: number; name: string | null };
          if (row.odoo_partner_id && row.name && !nameMap.has(row.odoo_partner_id)) nameMap.set(row.odoo_partner_id, row.name);
        });
      }
    }
  }

  const maxEntry = (counts: Record<string, number>): string | null => {
    let best: string | null = null;
    let bestN = 0;
    for (const [k, n] of Object.entries(counts)) {
      if (n > bestN) { bestN = n; best = k; }
    }
    return best;
  };

  const medianDay = (dates: number[]): number | null => {
    if (!dates.length) return null;
    const sorted = [...dates].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  };

  const results: PartnerPaymentProfile[] = Array.from(aggMap.values())
    .filter((a) => a.invoiceCount > 0)
    .map((a) => {
      const confidence = Math.min(1, (a.invoiceCount + a.payCount) / 20);
      const avgDaysToPay = a.daysToPayN > 0 ? Math.round(a.daysToPaySum / a.daysToPayN) : null;
      return {
        odooPartnerId: a.odooPartnerId,
        partnerName: nameMap.get(a.odooPartnerId) ?? null,
        paymentType: a.paymentType,
        paymentCount24m: a.payCount,
        monthsActive: 24, // approximation over 24m window
        totalPaidMxn: Math.round(a.totalPaid * 100) / 100,
        avgPaymentAmount: a.payCount > 0 ? Math.round((a.totalPaid / a.payCount) * 100) / 100 : 0,
        typicalDayOfMonth: medianDay(a.payDates),
        preferredBankJournal: maxEntry(a.journalCounts),
        preferredPaymentMethod: maxEntry(a.methodCounts),
        invoiceCount24m: a.invoiceCount,
        paidInvoiceCount: a.paidCount,
        avgDaysToPay,
        medianDaysToPay: avgDaysToPay, // single approximation; median requires per-invoice data
        stddevDaysToPay: null, // TODO SP6: compute from allocation timestamps
        totalInvoicedMxn: Math.round(a.totalInvoiced * 100) / 100,
        writeoffRiskCount: a.writeoffCount,
        writeoffRiskPct: a.invoiceCount > 0 ? Math.round((a.writeoffCount / a.invoiceCount) * 10000) / 100 : 0,
        confidence: Math.round(confidence * 100) / 100,
      };
    })
    .filter((p) => p.confidence >= minConfidence && p.invoiceCount24m > 0)
    .sort((a, b) => b.totalPaidMxn - a.totalPaidMxn)
    .slice(0, limit);

  return results;
}

export interface JournalFlowProfile {
  journalName: string;
  paymentType: 'inbound' | 'outbound';
  monthsActive: number;
  totalPayments12m: number;
  totalAmount12m: number;
  avgMonthlyAmount: number;
  stddevMonthlyAmount: number;
  volatilityCv: number | null;
}

export async function getJournalFlowProfiles(): Promise<JournalFlowProfile[]> {
  const sb = getServiceClient();
  // SP5-VERIFIED: journal_flow_profile retained (not in drop list §12)
  const { data } = await sb
    .from('journal_flow_profile')
    .select(
      'journal_name, payment_type, months_active, total_payments_12m, total_amount_12m, avg_monthly_amount, stddev_monthly_amount, volatility_cv',
    )
    .order('total_amount_12m', { ascending: false });
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const num = (v: unknown) => (v == null ? 0 : Number(v));
    return {
      journalName: (r.journal_name as string) ?? '',
      paymentType: r.payment_type as 'inbound' | 'outbound',
      monthsActive: num(r.months_active),
      totalPayments12m: num(r.total_payments_12m),
      totalAmount12m: num(r.total_amount_12m),
      avgMonthlyAmount: num(r.avg_monthly_amount),
      stddevMonthlyAmount: num(r.stddev_monthly_amount),
      volatilityCv: r.volatility_cv == null ? null : Number(r.volatility_cv),
    };
  });
}

export interface AccountPaymentProfile {
  odooAccountId: number;
  accountCode: string | null;
  accountName: string;
  accountType: string;
  detectedCategory: string;
  frequency: 'monthly' | 'irregular_monthly' | 'occasional' | 'dormant';
  monthsWithActivity: number;
  monthsInLast12m: number;
  avgMonthlyNet: number;
  medianMonthlyNet: number;
  stddevMonthlyNet: number;
  confidence: number;
  lastPeriodActive: string | null;
}

/**
 * getAccountPaymentProfiles — aggregates canonical_payments by payment_method_odoo.
 * Replaces account_payment_profile MV (232kB). Returns per-method aggregation.
 * Shape is adapted: odooAccountId=0 (no account FK in canonical_payments),
 * accountName = payment_method_odoo, detectedCategory = journal_name.
 */
export async function getAccountPaymentProfiles(
  categoryFilter?: string,
): Promise<AccountPaymentProfile[]> {
  const sb = getServiceClient();
  const cutoff12m = new Date();
  cutoff12m.setMonth(cutoff12m.getMonth() - 12);
  const cutoff12mStr = cutoff12m.toISOString().slice(0, 10);

  let q = sb
    .from("canonical_payments")
    .select("payment_method_odoo, journal_name, journal_type, amount_mxn_resolved, payment_date_resolved, direction")
    .gte("payment_date_resolved", cutoff12mStr);
  if (categoryFilter) q = q.eq("journal_name", categoryFilter);

  const { data } = await q;
  type PayRow = {
    payment_method_odoo: string | null;
    journal_name: string | null;
    journal_type: string | null;
    amount_mxn_resolved: number | null;
    payment_date_resolved: string | null;
    direction: string | null;
  };

  const rows = (data ?? []) as PayRow[];

  // Aggregate by method
  type MethodAgg = {
    method: string;
    journal: string;
    journalType: string;
    monthAmounts: Record<string, number>;
    total: number;
    n: number;
    lastPeriod: string;
  };

  const methodMap = new Map<string, MethodAgg>();
  for (const r of rows) {
    const method = r.payment_method_odoo ?? 'unknown';
    const journal = r.journal_name ?? 'unknown';
    const jtype = r.journal_type ?? '';
    const amt = Number(r.amount_mxn_resolved) || 0;
    const period = r.payment_date_resolved ? r.payment_date_resolved.slice(0, 7) : 'unknown';
    const key = method;
    if (!methodMap.has(key)) {
      methodMap.set(key, { method, journal, journalType: jtype, monthAmounts: {}, total: 0, n: 0, lastPeriod: '' });
    }
    const agg = methodMap.get(key)!;
    agg.total += amt;
    agg.n++;
    agg.monthAmounts[period] = (agg.monthAmounts[period] ?? 0) + amt;
    if (period > agg.lastPeriod) agg.lastPeriod = period;
  }

  return Array.from(methodMap.values()).map((a) => {
    const monthlyAmts = Object.values(a.monthAmounts);
    const monthsActive = monthlyAmts.length;
    const avg = monthsActive > 0 ? a.total / monthsActive : 0;
    const sorted = [...monthlyAmts].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const variance = monthlyAmts.length > 1
      ? monthlyAmts.reduce((s, v) => s + (v - avg) ** 2, 0) / (monthlyAmts.length - 1)
      : 0;
    const stddev = Math.sqrt(variance);
    const frequency: AccountPaymentProfile['frequency'] =
      monthsActive >= 10 ? 'monthly'
      : monthsActive >= 6 ? 'irregular_monthly'
      : monthsActive >= 2 ? 'occasional'
      : 'dormant';
    const confidence = Math.min(1, monthsActive / 12);
    return {
      odooAccountId: 0, // canonical_payments has no account FK
      accountCode: null,
      accountName: a.method,
      accountType: a.journalType,
      detectedCategory: a.journal,
      frequency,
      monthsWithActivity: monthsActive,
      monthsInLast12m: monthsActive,
      avgMonthlyNet: Math.round(avg * 100) / 100,
      medianMonthlyNet: Math.round(median * 100) / 100,
      stddevMonthlyNet: Math.round(stddev * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      lastPeriodActive: a.lastPeriod || null,
    };
  }).sort((a, b) => b.avgMonthlyNet - a.avgMonthlyNet);
}
