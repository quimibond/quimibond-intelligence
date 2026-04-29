import { unstable_cache } from "next/cache";

import { getServiceClient } from "@/lib/supabase-server";

export type OdooFixSeverity = "critical" | "high" | "medium" | "low";

export type OdooFixInsightType =
  | "odoo_duplicate_partner_rfc"
  | "odoo_partner_no_canonical"
  | "odoo_foreign_tax_id_in_rfc"
  | "odoo_sat_invoice_drift"
  | "mdm_contacts_duplicates"
  | "mdm_products_duplicates"
  | "mdm_contact_name_is_email"
  | "canonical_partner_orphan"
  | "canonical_invoice_pre_history";

export interface OdooFixRow {
  id: number;
  insight_type: OdooFixInsightType;
  severity: OdooFixSeverity;
  title: string;
  description: string;
  recommendation: string;
  evidence: Record<string, unknown>;
  business_impact_estimate: number | null;
  state: "new" | "seen";
  created_at: string;
  updated_at: string | null;
}

const ODOO_FIX_TYPES: OdooFixInsightType[] = [
  "odoo_duplicate_partner_rfc",
  "odoo_partner_no_canonical",
  "odoo_foreign_tax_id_in_rfc",
  "odoo_sat_invoice_drift",
  "mdm_contacts_duplicates",
  "mdm_products_duplicates",
  "mdm_contact_name_is_email",
  "canonical_partner_orphan",
  "canonical_invoice_pre_history",
];

const SEVERITY_RANK: Record<OdooFixSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

async function fetchOdooFixes(): Promise<OdooFixRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("agent_insights")
    .select(
      "id, insight_type, severity, title, description, recommendation, evidence, business_impact_estimate, state, created_at, updated_at"
    )
    .eq("category", "datos")
    .in("insight_type", ODOO_FIX_TYPES)
    .in("state", ["new", "seen"])
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`getOdooFixes: ${error.message}`);
  }

  const rows = (data ?? []) as OdooFixRow[];
  rows.sort((a, b) => {
    const sev =
      (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (sev !== 0) return sev;
    const impactA = a.business_impact_estimate ?? 0;
    const impactB = b.business_impact_estimate ?? 0;
    return impactB - impactA;
  });
  return rows;
}

export const getOdooFixes = unstable_cache(
  fetchOdooFixes,
  ["odoo-fixes-v3"],
  { revalidate: 60, tags: ["odoo-fixes"] }
);

export interface OdooFixSummary {
  total: number;
  byCategory: Record<OdooFixInsightType, number>;
  bySeverity: Record<OdooFixSeverity, number>;
  totalImpactMxn: number;
}

export function summarizeOdooFixes(rows: OdooFixRow[]): OdooFixSummary {
  const byCategory: Record<OdooFixInsightType, number> = {
    odoo_duplicate_partner_rfc: 0,
    odoo_partner_no_canonical: 0,
    odoo_foreign_tax_id_in_rfc: 0,
    odoo_sat_invoice_drift: 0,
    mdm_contacts_duplicates: 0,
    mdm_products_duplicates: 0,
    mdm_contact_name_is_email: 0,
    canonical_partner_orphan: 0,
    canonical_invoice_pre_history: 0,
  };
  const bySeverity: Record<OdooFixSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  let totalImpact = 0;
  for (const r of rows) {
    byCategory[r.insight_type] = (byCategory[r.insight_type] ?? 0) + 1;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    totalImpact += r.business_impact_estimate ?? 0;
  }
  return {
    total: rows.length,
    byCategory,
    bySeverity,
    totalImpactMxn: totalImpact,
  };
}

export const INSIGHT_TYPE_LABEL: Record<OdooFixInsightType, string> = {
  odoo_duplicate_partner_rfc: "Partner duplicado",
  odoo_partner_no_canonical: "Partner sin canonical",
  odoo_foreign_tax_id_in_rfc: "Tax-ID extranjero en RFC",
  odoo_sat_invoice_drift: "Drift Odoo↔SAT",
  mdm_contacts_duplicates: "Contactos duplicados",
  mdm_products_duplicates: "Productos duplicados",
  mdm_contact_name_is_email: "Contacto con email como nombre",
  canonical_partner_orphan: "Partner orphan",
  canonical_invoice_pre_history: "Factura pre-2013",
};
