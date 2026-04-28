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

  // Salesperson = latest canonical_sale_order.salesperson_name per company.
  // One limit-1 query per company runs in parallel — cheap under 10 and
  // avoids pulling thousands of orders for whales.
  const salespersonPairs = await Promise.all(
    rows.map(async (r) => {
      const { data: soRow } = await sb
        .from("canonical_sale_orders")
        .select("salesperson_name")
        .eq("canonical_company_id", r.canonical_company_id as number)
        .not("salesperson_name", "is", null)
        .order("date_order", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      return [r.canonical_company_id as number, soRow?.salesperson_name ?? null] as const;
    }),
  );
  const salespersonByCompany = new Map<number, string | null>(salespersonPairs);

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
  ["sp13-empresas-top-ltv-v2-mdm-cleanup"],
  { revalidate: 300, tags: ["companies"] },
);
