import { getServiceClient } from "@/lib/supabase-server";

export type IssueType =
  | "cancelled_but_posted"
  | "posted_but_sat_uncertified"
  | "sat_only_cfdi_received"
  | "sat_only_cfdi_issued"
  | "amount_mismatch"
  | "partner_blacklist_69b"
  | "payment_missing_complemento"
  | "complemento_missing_payment";

export type Severity = "critical" | "high" | "medium" | "low";

export interface IssueByType {
  type: IssueType;
  open: number;
  resolved_7d: number;
  severity: Severity;
}

export interface IssueBySeverity {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface TopCompany {
  company_id: number;
  name: string | null;
  open: number;
}

export interface RecentCriticalIssue {
  issue_id: string;
  type: IssueType;
  severity: Severity;
  description: string;
  company: string | null;
  company_id: number | null;
  odoo_invoice_id: number | null;
  uuid_sat: string | null;
  amount_diff: string | null;
  detected_at: string;
}

export interface SyntageReconciliationSummary {
  by_type: IssueByType[];
  by_severity: IssueBySeverity;
  top_companies: TopCompany[];
  resolution_rate_7d: number;
  recent_critical: RecentCriticalIssue[];
  generated_at: string;
  invoices_unified_refreshed_at: string | null;
  payments_unified_refreshed_at: string | null;
}

const DEFAULT_SUMMARY: SyntageReconciliationSummary = {
  by_type: [],
  by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
  top_companies: [],
  resolution_rate_7d: 0,
  recent_critical: [],
  generated_at: new Date().toISOString(),
  invoices_unified_refreshed_at: null,
  payments_unified_refreshed_at: null,
};

export async function getSyntageReconciliationSummary(): Promise<SyntageReconciliationSummary> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("get_syntage_reconciliation_summary");
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_SUMMARY;
  return data as SyntageReconciliationSummary;
}
