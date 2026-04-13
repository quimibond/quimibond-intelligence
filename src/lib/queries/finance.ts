import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

export interface BankBalance {
  name: string | null;
  currency: string | null;
  current_balance: number | null;
  company_name: string | null;
}

export async function getBankBalances(): Promise<BankBalance[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("odoo_bank_balances")
    .select("name, currency, current_balance, company_name")
    .order("current_balance", { ascending: false });
  return (data ?? []) as BankBalance[];
}

export interface CashflowPoint {
  period: string | null;
  flow_type: string | null;
  gross_amount: number | null;
  net_amount: number | null;
  probability: number | null;
}

export async function getCashflowProjection(): Promise<CashflowPoint[]> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("cashflow_projection")
    .select("period, flow_type, gross_amount, net_amount, probability, sort_order")
    .order("sort_order", { ascending: true });
  return (data ?? []) as CashflowPoint[];
}

export interface FinanceKpis {
  cashMxn: number;
  cashUsdConverted: number;
  arTotal: number;
  apTotal: number;
  netPosition: number;
}

export async function getFinanceKpis(): Promise<FinanceKpis> {
  const sb = getServiceClient();
  const [bank, ar, ap] = await Promise.all([
    sb
      .from("odoo_bank_balances")
      .select("current_balance, currency"),
    sb
      .from("odoo_invoices")
      .select("amount_residual_mxn")
      .eq("move_type", "out_invoice")
      .in("payment_state", ["not_paid", "partial"]),
    sb
      .from("odoo_invoices")
      .select("amount_residual_mxn")
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
  const cashUsdConverted = bankRows
    .filter((r) => r.currency === "USD")
    .reduce((a, r) => a + (Number(r.current_balance) || 0), 0);

  const arTotal = ((ar.data ?? []) as Array<{
    amount_residual_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_residual_mxn) || 0), 0);
  const apTotal = ((ap.data ?? []) as Array<{
    amount_residual_mxn: number | null;
  }>).reduce((a, r) => a + (Number(r.amount_residual_mxn) || 0), 0);

  return {
    cashMxn,
    cashUsdConverted,
    arTotal,
    apTotal,
    netPosition: cashMxn + arTotal - apTotal,
  };
}
