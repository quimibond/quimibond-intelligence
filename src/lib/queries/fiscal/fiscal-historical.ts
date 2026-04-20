import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface FiscalRevenueMonthlyRow {
  month: string;
  revenue_mxn: number;
  gasto_mxn: number;
  cfdis_emitidos: number;
  cfdis_recibidos: number;
  clientes_unicos: number;
}

export interface TopClientFiscalRow {
  rfc: string | null;
  name: string | null;
  lifetime_revenue_mxn: number;
  revenue_12m_mxn: number;
  revenue_prev_12m_mxn: number;
  yoy_pct: number | null;
  cancellation_rate_pct: number | null;
  days_since_last_cfdi: number | null;
  company_id: number | null;
  first_cfdi: string | null;
}

export interface TopSupplierFiscalRow {
  rfc: string | null;
  name: string | null;
  lifetime_spend_mxn: number;
  spend_12m_mxn: number;
  spend_prev_12m_mxn: number;
  yoy_pct: number | null;
  retenciones_lifetime_mxn: number | null;
  company_id: number | null;
}

export type CompanyFiscalClientProfile = TopClientFiscalRow;
export type CompanyFiscalSupplierProfile = TopSupplierFiscalRow;

export interface CompanyFiscalProfile {
  client: CompanyFiscalClientProfile | null;
  supplier: CompanyFiscalSupplierProfile | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────────────────

export const getFiscalRevenueMonthly = unstable_cache(
  async (months: number = 24): Promise<FiscalRevenueMonthlyRow[]> => {
    const sb = getServiceClient();
    const { data } = await sb
      .from("syntage_revenue_fiscal_monthly")
      .select(
        "month, revenue_mxn, gasto_mxn, cfdis_emitidos, cfdis_recibidos, clientes_unicos"
      )
      .order("month", { ascending: false })
      .limit(months);
    return (data ?? []) as FiscalRevenueMonthlyRow[];
  },
  ["fiscal-revenue-monthly"],
  { revalidate: 300, tags: ["syntage-historical"] }
);

export const getTopClientsFiscalLifetime = unstable_cache(
  async (limit: number = 20): Promise<TopClientFiscalRow[]> => {
    const sb = getServiceClient();
    const { data } = await sb
      .from("syntage_top_clients_fiscal_lifetime")
      .select(
        "rfc, name, lifetime_revenue_mxn, revenue_12m_mxn, revenue_prev_12m_mxn, yoy_pct, cancellation_rate_pct, days_since_last_cfdi, company_id, first_cfdi"
      )
      .order("lifetime_revenue_mxn", { ascending: false })
      .limit(limit);
    return (data ?? []) as TopClientFiscalRow[];
  },
  ["fiscal-top-clients-lifetime"],
  { revalidate: 300, tags: ["syntage-historical"] }
);

export const getTopSuppliersFiscalLifetime = unstable_cache(
  async (limit: number = 20): Promise<TopSupplierFiscalRow[]> => {
    const sb = getServiceClient();
    const { data } = await sb
      .from("syntage_top_suppliers_fiscal_lifetime")
      .select(
        "rfc, name, lifetime_spend_mxn, spend_12m_mxn, spend_prev_12m_mxn, yoy_pct, retenciones_lifetime_mxn, company_id"
      )
      .order("lifetime_spend_mxn", { ascending: false })
      .limit(limit);
    return (data ?? []) as TopSupplierFiscalRow[];
  },
  ["fiscal-top-suppliers-lifetime"],
  { revalidate: 300, tags: ["syntage-historical"] }
);

/**
 * Fiscal KPI aggregates for /finanzas card.
 * Sum revenue last 12m vs prev 12m from syntage_revenue_fiscal_monthly.
 */
export const getFiscalRevenueKpi = unstable_cache(
  async (): Promise<{ rev12m: number; revPrev12m: number; yoyPct: number | null }> => {
    const rows = await getFiscalRevenueMonthly(24);
    if (!rows.length) return { rev12m: 0, revPrev12m: 0, yoyPct: null };

    // rows are ordered newest-first; first 12 = last 12m, next 12 = prev 12m
    const last12 = rows.slice(0, 12);
    const prev12 = rows.slice(12, 24);

    const rev12m = last12.reduce((s, r) => s + (r.revenue_mxn ?? 0), 0);
    const revPrev12m = prev12.reduce((s, r) => s + (r.revenue_mxn ?? 0), 0);
    const yoyPct =
      revPrev12m > 0 ? ((rev12m - revPrev12m) / revPrev12m) * 100 : null;

    return { rev12m, revPrev12m, yoyPct };
  },
  ["fiscal-revenue-kpi"],
  { revalidate: 300, tags: ["syntage-historical"] }
);

/**
 * Fiscal profile for a single company — looks up by company_id in both
 * top_clients and top_suppliers views.
 */
export async function getCompanyFiscalProfile(
  companyId: number
): Promise<CompanyFiscalProfile> {
  const sb = getServiceClient();

  const [clientRes, supplierRes] = await Promise.all([
    sb
      .from("syntage_top_clients_fiscal_lifetime")
      .select(
        "rfc, name, lifetime_revenue_mxn, revenue_12m_mxn, revenue_prev_12m_mxn, yoy_pct, cancellation_rate_pct, days_since_last_cfdi, company_id, first_cfdi"
      )
      .eq("company_id", companyId)
      .limit(1) // intentional: single profile row per company
      .maybeSingle(),
    sb
      .from("syntage_top_suppliers_fiscal_lifetime")
      .select(
        "rfc, name, lifetime_spend_mxn, spend_12m_mxn, spend_prev_12m_mxn, yoy_pct, retenciones_lifetime_mxn, company_id"
      )
      .eq("company_id", companyId)
      .limit(1) // intentional: single profile row per company
      .maybeSingle(),
  ]);

  return {
    client: (clientRes.data as CompanyFiscalClientProfile | null) ?? null,
    supplier: (supplierRes.data as CompanyFiscalSupplierProfile | null) ?? null,
  };
}
