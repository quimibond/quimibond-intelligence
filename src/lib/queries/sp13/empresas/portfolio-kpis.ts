import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * SP13 E1 Hero — distribución del portafolio.
 *
 * Clasificación:
 *   activeCustomers  = is_customer AND last_invoice_date >= NOW() - 12m
 *   activeSuppliers  = is_supplier AND last_invoice_date >= NOW() - 12m
 *   dormant          = (is_customer OR is_supplier) AND last_invoice_date < NOW() - 12m
 *   blacklist        = blacklist_level IN ('69b_presunto','69b_definitivo')
 *
 * Excluye Quimibond self (canonical_company_id = 868).
 */
export interface SP13PortfolioKpis {
  activeCustomers: number;
  activeSuppliers: number;
  dormant: number;
  blacklist: number;
}

const QUIMIBOND_SELF_ID = 868;

function cutoff12mIso(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12);
  return d.toISOString();
}

async function _getPortfolioKpisUncached(): Promise<SP13PortfolioKpis> {
  const sb = getServiceClient();
  const cutoff = cutoff12mIso();

  const [activeCustRes, activeSupRes, dormantRes, blacklistRes] = await Promise.all([
    sb
      .from("gold_company_360")
      .select("canonical_company_id", { head: true, count: "exact" })
      .eq("is_customer", true)
      .gte("last_invoice_date", cutoff)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    sb
      .from("gold_company_360")
      .select("canonical_company_id", { head: true, count: "exact" })
      .eq("is_supplier", true)
      .gte("last_invoice_date", cutoff)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    // Dormidos: has been a customer o proveedor (LTV>0) pero sin facturación reciente
    sb
      .from("gold_company_360")
      .select("canonical_company_id", { head: true, count: "exact" })
      .or("is_customer.eq.true,is_supplier.eq.true")
      .or(`last_invoice_date.lt.${cutoff},last_invoice_date.is.null`)
      .gt("lifetime_value_mxn", 0)
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
    sb
      .from("gold_company_360")
      .select("canonical_company_id", { head: true, count: "exact" })
      .in("blacklist_level", ["69b_presunto", "69b_definitivo"])
      .neq("canonical_company_id", QUIMIBOND_SELF_ID),
  ]);

  return {
    activeCustomers: activeCustRes.count ?? 0,
    activeSuppliers: activeSupRes.count ?? 0,
    dormant: dormantRes.count ?? 0,
    blacklist: blacklistRes.count ?? 0,
  };
}

export const getPortfolioKpis = unstable_cache(
  _getPortfolioKpisUncached,
  ["sp13-empresas-portfolio-kpis"],
  { revalidate: 300, tags: ["companies"] },
);
