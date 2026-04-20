import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

export interface PnlByAccountRow {
  account_code: string | null;
  account_name: string | null;
  account_type: string | null;
  period: string;
  debit: number;
  credit: number;
  net: number;
}

export async function getMostRecentPeriod(): Promise<string | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("odoo_account_balances")
    .select("period")
    .order("period", { ascending: false })
    .limit(1); // intentional: latest period lookup
  if (error || !data || data.length === 0) return null;
  return data[0].period as string;
}

/**
 * getPnlByAccount — returns trial-balance rows for a given period.
 * `odoo_account_balances` already has account_code, account_name,
 * account_type denormalized — no join to odoo_chart_of_accounts needed.
 */
export async function getPnlByAccount(
  period?: string,
  limit = 300,
): Promise<PnlByAccountRow[]> {
  const sb = getServiceClient();

  const targetPeriod = period ?? (await getMostRecentPeriod());
  if (!targetPeriod) return [];

  const { data, error } = await sb
    .from("odoo_account_balances")
    .select("account_code, account_name, account_type, period, debit, credit, balance")
    .eq("period", targetPeriod)
    .order("account_code", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`pnl by account query failed: ${error.message}`);

  return (data ?? []).map((b): PnlByAccountRow => {
    const debit = Number(b.debit ?? 0);
    const credit = Number(b.credit ?? 0);
    return {
      account_code: b.account_code ?? null,
      account_name: b.account_name ?? null,
      account_type: b.account_type ?? null,
      period: b.period as string,
      debit,
      credit,
      net: debit - credit,
    };
  });
}
