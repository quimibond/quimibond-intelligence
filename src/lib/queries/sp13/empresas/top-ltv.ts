import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * SP13 E2 — Top LTV. Los 5 clientes mas importantes por lifetime_value_mxn.
 *
 * Fuente: gold_company_360 + salesperson derivado de canonical_sale_orders.
 * Excluye Quimibond self (id=868).
 * Salesperson: mas reciente por canonical_sale_orders.date_order desc.
 */
export interface TopLtvCustomer {
  canonical_company_id: number;
  display_name: string;
  lifetime_value_mxn: number;
  revenue_ytd_mxn: number;
  tier: string | null;
  salesperson: string | null;
  has_shadow_flag: boolean;
}

const QUIMIBOND_SELF_ID = 868;

async function _getTopLtvCustomersUncached(
  limit: number = 5,
): Promise<TopLtvCustomer[]> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("gold_company_360")
    .select(
      "canonical_company_id, display_name, lifetime_value_mxn, revenue_ytd_mxn, tier, has_shadow_flag",
    )
    .eq("is_customer", true)
    .neq("canonical_company_id", QUIMIBOND_SELF_ID)
    .gt("lifetime_value_mxn", 0)
    .order("lifetime_value_mxn", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows
    .map((r) => r.canonical_company_id)
    .filter((id): id is number => id != null);

  const { data: soData } = await sb
    .from("canonical_sale_orders")
    .select("canonical_company_id, salesperson_name, date_order")
    .in("canonical_company_id", ids)
    .not("salesperson_name", "is", null)
    .order("date_order", { ascending: false, nullsFirst: false });

  const salespersonByCompany = new Map<number, string>();
  for (const so of (soData ?? []) as Array<{
    canonical_company_id: number | null;
    salesperson_name: string | null;
  }>) {
    if (so.canonical_company_id == null) continue;
    if (!salespersonByCompany.has(so.canonical_company_id) && so.salesperson_name) {
      salespersonByCompany.set(so.canonical_company_id, so.salesperson_name);
    }
  }

  return rows.map((r) => ({
    canonical_company_id: r.canonical_company_id as number,
    display_name: r.display_name ?? "—",
    lifetime_value_mxn: Number(r.lifetime_value_mxn) || 0,
    revenue_ytd_mxn: Number(r.revenue_ytd_mxn) || 0,
    tier: r.tier ?? null,
    salesperson: salespersonByCompany.get(r.canonical_company_id as number) ?? null,
    has_shadow_flag: Boolean(r.has_shadow_flag),
  }));
}

export const getTopLtvCustomers = unstable_cache(
  _getTopLtvCustomersUncached,
  ["sp13-empresas-top-ltv"],
  { revalidate: 300, tags: ["companies"] },
);
