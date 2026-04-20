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
    .from("odoo_payments")
    .select(
      "id, name, payment_type, amount, currency, payment_date, state, payment_category, amount_mxn, synced_at",
    )
    .eq("company_id", companyId)
    .order("payment_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`company payments query failed: ${error.message}`);
  return (data ?? []) as CompanyPaymentRow[];
}
