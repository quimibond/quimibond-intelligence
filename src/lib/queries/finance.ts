import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { toMxn } from "@/lib/formatters";

export interface BankBalance {
  name: string | null;
  currency: string | null;
  current_balance: number | null;
  company_name: string | null;
  journal_type: string | null;
}

export async function getBankBalances(): Promise<BankBalance[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_bank_balances")
    .select("name, currency, current_balance, company_name, journal_type")
    .order("current_balance", { ascending: false });
  return (data ?? []) as BankBalance[];
}

/**
 * Proyección de cobranza por mes.
 * La MV `cashflow_projection` está pre-agregada. Usamos `flow_type='receivable_by_month'`
 * que ya trae un row por mes con expected_amount (con probabilidad aplicada)
 * y amount_residual (bruto sin probabilidad).
 */
export interface CashflowPoint {
  month: string; // YYYY-MM
  expectedAmount: number; // con probabilidad de cobro aplicada
  residualAmount: number; // bruto por cobrar
  collectionProbability: number | null;
}

export async function getCashflowProjection(
  monthsAhead = 6
): Promise<CashflowPoint[]> {
  const sb = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from("cashflow_projection")
    .select(
      "projected_date, expected_amount, amount_residual, collection_probability"
    )
    .eq("flow_type", "receivable_by_month")
    .gte("projected_date", today)
    .order("projected_date", { ascending: true })
    .limit(monthsAhead);

  const rows = (data ?? []) as Array<{
    projected_date: string | null;
    expected_amount: number | null;
    amount_residual: number | null;
    collection_probability: number | null;
  }>;

  return rows
    .filter((r) => r.projected_date)
    .map((r) => ({
      month: (r.projected_date as string).slice(0, 7),
      expectedAmount: Number(r.expected_amount) || 0,
      residualAmount: Number(r.amount_residual) || 0,
      collectionProbability: r.collection_probability
        ? Number(r.collection_probability)
        : null,
    }));
}

/**
 * Aging buckets del AR (`receivable_bucket`).
 * 4 rows pre-computados: 0-30, 31-60, 61-90, 90+.
 */
export interface ReceivableBucket {
  bucket: string;
  expectedAmount: number;
  residualAmount: number;
  collectionProbability: number | null;
}

export async function getReceivableBuckets(): Promise<ReceivableBucket[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("cashflow_projection")
    .select(
      "bucket, expected_amount, amount_residual, collection_probability"
    )
    .eq("flow_type", "receivable_bucket");
  const rows = (data ?? []) as Array<{
    bucket: string | null;
    expected_amount: number | null;
    amount_residual: number | null;
    collection_probability: number | null;
  }>;
  // Orden fijo para consistencia visual
  const order = ["0-30 dias", "31-60 dias", "61-90 dias", "90+ dias"];
  return rows
    .filter((r) => r.bucket)
    .sort(
      (a, b) => order.indexOf(a.bucket ?? "") - order.indexOf(b.bucket ?? "")
    )
    .map((r) => ({
      bucket: r.bucket ?? "—",
      expectedAmount: Number(r.expected_amount) || 0,
      residualAmount: Number(r.amount_residual) || 0,
      collectionProbability: r.collection_probability
        ? Number(r.collection_probability)
        : null,
    }));
}

export interface FinanceKpis {
  cashMxn: number;
  cashUsd: number;
  arTotal: number;
  apTotal: number;
  netPosition: number;
}

export async function getFinanceKpis(): Promise<FinanceKpis> {
  const sb = getServiceClient();
  const [bank, ar, ap] = await Promise.all([
    sb.from("odoo_bank_balances").select("current_balance, currency"),
    sb
      .from("odoo_invoices")
      .select("amount_residual, currency")
      .eq("move_type", "out_invoice")
      .in("payment_state", ["not_paid", "partial"]),
    sb
      .from("odoo_invoices")
      .select("amount_residual, currency")
      .eq("move_type", "in_invoice")
      .in("payment_state", ["not_paid", "partial"]),
  ]);

  const bankRows = (bank.data ?? []) as Array<{
    current_balance: number | null;
    currency: string | null;
  }>;
  const cashMxn = bankRows
    .filter((r) => r.currency === "MXN")
    .reduce((a, r) => a + (Number(r.current_balance) || 0), 0);
  const cashUsd = bankRows
    .filter((r) => r.currency === "USD")
    .reduce((a, r) => a + (Number(r.current_balance) || 0), 0);

  const arTotal = ((ar.data ?? []) as Array<{
    amount_residual: number | null;
    currency: string | null;
  }>).reduce((a, r) => a + toMxn(r.amount_residual, r.currency), 0);
  const apTotal = ((ap.data ?? []) as Array<{
    amount_residual: number | null;
    currency: string | null;
  }>).reduce((a, r) => a + toMxn(r.amount_residual, r.currency), 0);

  return {
    cashMxn,
    cashUsd,
    arTotal,
    apTotal,
    netPosition: cashMxn + arTotal - apTotal,
  };
}
