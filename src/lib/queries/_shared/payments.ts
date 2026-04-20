import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

export interface CompanyPaymentRow {
  id: number;
  name: string | null;
  payment_type: string | null;
  amount: number | null;
  currency: string | null;
  payment_date: string | null;
  state: string | null;
  payment_category: string | null;
  amount_mxn: number | null;
  synced_at: string | null;
}

export async function getCompanyPayments(
  companyId: number,
  limit = 100,
): Promise<CompanyPaymentRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("odoo_account_payments")
    .select(
      "id, name, payment_type, amount, currency, date, state, partner_type, amount_signed, synced_at",
    )
    .eq("company_id", companyId)
    .order("date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`company payments query failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as number,
    name: (r.name as string | null) ?? null,
    payment_type: (r.payment_type as string | null) ?? null,
    amount: (r.amount as number | null) ?? null,
    currency: (r.currency as string | null) ?? null,
    payment_date: (r.date as string | null) ?? null,
    state: (r.state as string | null) ?? null,
    payment_category:
      r.partner_type === "customer"
        ? "customer"
        : r.partner_type === "supplier"
          ? "supplier"
          : null,
    amount_mxn: (r.amount_signed as number | null) ?? null,
    synced_at: (r.synced_at as string | null) ?? null,
  }));
}
