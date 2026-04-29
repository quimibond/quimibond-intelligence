import { unstable_cache } from "next/cache";

import { getServiceClient } from "@/lib/supabase-server";
import type { OdooFixRow } from "./odoo-fixes";

// ─────────────────────────────────────────────────────────────────
// getOdooFixById — fetch single insight by id (for /datos/[id] router)
// ─────────────────────────────────────────────────────────────────

async function fetchOdooFixById(id: number): Promise<OdooFixRow | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("agent_insights")
    .select(
      "id, insight_type, severity, title, description, recommendation, evidence, business_impact_estimate, state, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getOdooFixById: ${error.message}`);
  return (data ?? null) as OdooFixRow | null;
}

export const getOdooFixById = unstable_cache(fetchOdooFixById, ["odoo-fix-by-id"], {
  revalidate: 60,
  tags: ["odoo-fixes"],
});

// ─────────────────────────────────────────────────────────────────
// A) odoo_sat_invoice_drift detail — reconciliation_issues by invariant_key
// ─────────────────────────────────────────────────────────────────

export interface SatInvoiceDriftDetailRow {
  issue_id: string;
  uuid_sat: string | null;
  odoo_invoice_id: number | null;
  severity: string;
  impact_mxn: number | null;
  age_days: number | null;
  description: string | null;
  detected_at: string;
  priority_score: number | null;
  company_id: number | null;
}

async function fetchSatInvoiceDriftDetail(
  invariantKey: string
): Promise<SatInvoiceDriftDetailRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("reconciliation_issues")
    .select(
      "issue_id, uuid_sat, odoo_invoice_id, severity, impact_mxn, age_days, description, detected_at, priority_score, company_id"
    )
    .eq("invariant_key", invariantKey)
    .is("resolved_at", null)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .order("age_days", { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) throw new Error(`getSatInvoiceDriftDetail: ${error.message}`);
  return (data ?? []) as SatInvoiceDriftDetailRow[];
}

export const getSatInvoiceDriftDetail = unstable_cache(
  fetchSatInvoiceDriftDetail,
  ["sat-invoice-drift-detail"],
  { revalidate: 60, tags: ["odoo-fixes"] }
);

// ─────────────────────────────────────────────────────────────────
// B) odoo_duplicate_partner_rfc detail — companies bronze with same RFC
// ─────────────────────────────────────────────────────────────────

export interface DuplicatePartnerRfcDetailRow {
  odoo_partner_id: number;
  name: string | null;
  country: string | null;
  is_customer: boolean | null;
  is_supplier: boolean | null;
  created_at: string;
  updated_at: string | null;
}

async function fetchDuplicatePartnerRfcDetail(
  rfc: string
): Promise<DuplicatePartnerRfcDetailRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("companies")
    .select(
      "odoo_partner_id, name, country, is_customer, is_supplier, created_at, updated_at"
    )
    .eq("rfc", rfc)
    .order("odoo_partner_id");

  if (error) throw new Error(`getDuplicatePartnerRfcDetail: ${error.message}`);
  return (data ?? []) as DuplicatePartnerRfcDetailRow[];
}

export const getDuplicatePartnerRfcDetail = unstable_cache(
  fetchDuplicatePartnerRfcDetail,
  ["duplicate-partner-rfc-detail"],
  { revalidate: 60, tags: ["odoo-fixes"] }
);

// ─────────────────────────────────────────────────────────────────
// C) odoo_partner_no_canonical detail — payments by orphan partner_id
// ─────────────────────────────────────────────────────────────────

export interface PartnerNoCanonicalDetailRow {
  canonical_id: string;
  sat_uuid_complemento: string | null;
  fecha_pago_sat: string | null;
  amount_mxn_sat: number | null;
  amount_sat: number | null;
  partner_name: string | null;
  direction: string | null;
}

async function fetchPartnerNoCanonicalDetail(
  odooPartnerId: number
): Promise<PartnerNoCanonicalDetailRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_payments")
    .select(
      "canonical_id, sat_uuid_complemento, fecha_pago_sat, amount_mxn_sat, amount_sat, partner_name, direction"
    )
    .eq("odoo_partner_id", odooPartnerId)
    .order("fecha_pago_sat", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) throw new Error(`getPartnerNoCanonicalDetail: ${error.message}`);
  return (data ?? []) as PartnerNoCanonicalDetailRow[];
}

export const getPartnerNoCanonicalDetail = unstable_cache(
  fetchPartnerNoCanonicalDetail,
  ["partner-no-canonical-detail"],
  { revalidate: 60, tags: ["odoo-fixes"] }
);

// ─────────────────────────────────────────────────────────────────
// D) odoo_foreign_tax_id_in_rfc detail — single bronze company
// ─────────────────────────────────────────────────────────────────

export interface ForeignTaxIdDetailRow {
  odoo_partner_id: number;
  name: string | null;
  rfc: string | null;
  country: string | null;
  is_customer: boolean | null;
  is_supplier: boolean | null;
  created_at: string;
  invoice_count: number;
}

async function fetchForeignTaxIdDetail(
  odooPartnerId: number
): Promise<ForeignTaxIdDetailRow | null> {
  const sb = getServiceClient();
  const { data: company, error } = await sb
    .from("companies")
    .select(
      "odoo_partner_id, name, rfc, country, is_customer, is_supplier, created_at"
    )
    .eq("odoo_partner_id", odooPartnerId)
    .maybeSingle();

  if (error) throw new Error(`getForeignTaxIdDetail: ${error.message}`);
  if (!company) return null;

  const { count } = await sb
    .from("canonical_invoices")
    .select("*", { count: "exact", head: true })
    .eq("odoo_partner_id", odooPartnerId);

  return { ...company, invoice_count: count ?? 0 } as ForeignTaxIdDetailRow;
}

export const getForeignTaxIdDetail = unstable_cache(
  fetchForeignTaxIdDetail,
  ["foreign-tax-id-detail"],
  { revalidate: 60, tags: ["odoo-fixes"] }
);

// ─────────────────────────────────────────────────────────────────
// E) mdm_contacts_duplicates detail — all dup groups with members
// ─────────────────────────────────────────────────────────────────

export interface ContactDuplicateGroup {
  canonical_name: string;
  dup_count: number;
  members: Array<{
    id: number;
    email: string | null;
    company_id: number | null;
  }>;
}

async function fetchContactsDuplicatesDetail(): Promise<ContactDuplicateGroup[]> {
  const sb = getServiceClient();
  // Use raw RPC-style: we don't have a function, so do client-side aggregation
  // by paging. For 488 rows this is fine.
  const { data, error } = await sb
    .from("canonical_contacts")
    .select("id, canonical_name, primary_email, canonical_company_id")
    .not("canonical_name", "is", null)
    .order("canonical_name")
    .order("id")
    .limit(2000);

  if (error) throw new Error(`getContactsDuplicatesDetail: ${error.message}`);

  const groups = new Map<string, ContactDuplicateGroup>();
  for (const r of data ?? []) {
    const name = (r as { canonical_name: string }).canonical_name;
    if (!groups.has(name)) {
      groups.set(name, { canonical_name: name, dup_count: 0, members: [] });
    }
    const g = groups.get(name)!;
    g.members.push({
      id: (r as { id: number }).id,
      email: (r as { primary_email: string | null }).primary_email,
      company_id: (r as { canonical_company_id: number | null })
        .canonical_company_id,
    });
    g.dup_count = g.members.length;
  }
  return Array.from(groups.values())
    .filter((g) => g.dup_count > 1)
    .sort((a, b) => b.dup_count - a.dup_count);
}

export const getContactsDuplicatesDetail = unstable_cache(
  fetchContactsDuplicatesDetail,
  ["contacts-duplicates-detail"],
  { revalidate: 60, tags: ["odoo-fixes"] }
);

// ─────────────────────────────────────────────────────────────────
// F) mdm_products_duplicates detail — same as E but for products
// ─────────────────────────────────────────────────────────────────

export interface ProductDuplicateGroup {
  canonical_name: string;
  dup_count: number;
  members: Array<{
    id: number;
    internal_ref: string | null;
    odoo_product_id: number | null;
    stock_qty: number | null;
  }>;
}

async function fetchProductsDuplicatesDetail(): Promise<ProductDuplicateGroup[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_products")
    .select("id, canonical_name, internal_ref, odoo_product_id, stock_qty")
    .not("canonical_name", "is", null)
    .order("canonical_name")
    .order("id")
    .limit(7000);

  if (error) throw new Error(`getProductsDuplicatesDetail: ${error.message}`);

  const groups = new Map<string, ProductDuplicateGroup>();
  for (const r of data ?? []) {
    const name = (r as { canonical_name: string }).canonical_name;
    if (!groups.has(name)) {
      groups.set(name, { canonical_name: name, dup_count: 0, members: [] });
    }
    const g = groups.get(name)!;
    g.members.push({
      id: (r as { id: number }).id,
      internal_ref: (r as { internal_ref: string | null }).internal_ref,
      odoo_product_id: (r as { odoo_product_id: number | null }).odoo_product_id,
      stock_qty: (r as { stock_qty: number | null }).stock_qty,
    });
    g.dup_count = g.members.length;
  }
  return Array.from(groups.values())
    .filter((g) => g.dup_count > 1)
    .sort((a, b) => b.dup_count - a.dup_count);
}

export const getProductsDuplicatesDetail = unstable_cache(
  fetchProductsDuplicatesDetail,
  ["products-duplicates-detail"],
  { revalidate: 60, tags: ["odoo-fixes"] }
);
