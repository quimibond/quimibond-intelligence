import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * customer-360.ts — Gold layer reads via gold_company_360.
 *
 * gold_company_360 is the canonical per-company snapshot combining
 * canonical_companies + canonical_invoices + canonical_payments + MDM.
 * PK: canonical_company_id.
 */

// ──────────────────────────────────────────────────────────────────────────
// Customer 360 snapshot (gold_company_360)
// ──────────────────────────────────────────────────────────────────────────

export async function fetchCustomer360(canonical_company_id: number) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("gold_company_360")
    .select("*")
    .eq("canonical_company_id", canonical_company_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Legacy alias — preserves consumers that call getCustomer360(companyId)
// Note: companyId here is canonical_company_id (SP3 MDM onward).
export async function getCustomer360(
  canonical_company_id: number
): Promise<ReturnType<typeof fetchCustomer360> extends Promise<infer T> ? T : never> {
  return fetchCustomer360(canonical_company_id) as never;
}

// ──────────────────────────────────────────────────────────────────────────
// Top customers ranked by lifetime_value_mxn
// ──────────────────────────────────────────────────────────────────────────

export async function fetchTopCustomers(
  opts: { limit?: number; minLtv?: number } = {}
) {
  const sb = getServiceClient();
  let q = sb
    .from("gold_company_360")
    .select(
      "canonical_company_id, display_name, rfc, lifetime_value_mxn, revenue_ytd_mxn, open_company_issues_count, blacklist_level"
    )
    .eq("is_customer", true)
    .order("lifetime_value_mxn", { ascending: false, nullsFirst: false });
  if (opts.minLtv) q = q.gte("lifetime_value_mxn", opts.minLtv);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ──────────────────────────────────────────────────────────────────────────
// Top suppliers ranked by lifetime_value_mxn
// ──────────────────────────────────────────────────────────────────────────

export async function fetchTopSuppliers(opts: { limit?: number } = {}) {
  const sb = getServiceClient();
  let q = sb
    .from("gold_company_360")
    .select(
      "canonical_company_id, display_name, rfc, lifetime_value_mxn, overdue_amount_mxn, blacklist_level"
    )
    .eq("is_supplier", true)
    .order("lifetime_value_mxn", { ascending: false, nullsFirst: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ──────────────────────────────────────────────────────────────────────────
// Top at-risk clients — consumers of getTopAtRiskClients moved here
// Reads gold_company_360 (churn_risk not present → use overdue_amount_mxn + blacklist_level)
// ──────────────────────────────────────────────────────────────────────────

// AtRiskClient — see dashboard.ts for the canonical version with back-compat aliases.
// Re-exported from dashboard.ts via index.ts barrel.

// ──────────────────────────────────────────────────────────────────────────
// Company insights (agent_insights — operational table, not dropped)
// ──────────────────────────────────────────────────────────────────────────

export interface CompanyInsightRow {
  id: number;
  title: string | null;
  description: string | null;
  severity: string | null;
  category: string | null;
  created_at: string | null;
  agent_name: string | null;
}

export async function getCompanyInsights(
  canonical_company_id: number,
  limit = 3
): Promise<CompanyInsightRow[]> {
  const sb = getServiceClient();
  // agent_insights.company_id is the legacy companies.id; SP5-TODO: migrate to canonical_company_id when routing table is updated
  const { data } = await sb
    .from("agent_insights")
    .select(
      "id, title, description, severity, category, created_at, ai_agents:agent_id(name)"
    )
    .eq("company_id", canonical_company_id)
    .in("state", ["new", "seen"])
    .order("created_at", { ascending: false })
    .limit(limit);

  type Raw = Omit<CompanyInsightRow, "agent_name"> & {
    ai_agents: unknown;
  };

  return ((data ?? []) as unknown as Raw[]).map((row) => {
    const ag = Array.isArray(row.ai_agents)
      ? (row.ai_agents[0] as { name?: string } | undefined)
      : (row.ai_agents as { name?: string } | null);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      category: row.category,
      created_at: row.created_at,
      agent_name: ag?.name ?? null,
    };
  });
}
