import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { paginationRange, type TableParams } from "./table-params";
import { CEO_VISIBLE_FILTER } from "../intelligence/insights";

/**
 * Contacts queries — reads from canonical_contacts (SP3 MDM layer).
 *
 * contact_type values in canonical_contacts:
 *   internal_employee, internal_user, internal_both  → Quimibond staff
 *   customer, supplier, both, unknown                → external contacts
 *
 * Legacy tables removed: contacts, companies (join), odoo_users, odoo_employees
 */

// ──────────────────────────────────────────────────────────────────────────
// Shared interface for list rows (mirrors prior shape for consumer compat)
// ──────────────────────────────────────────────────────────────────────────
export interface ContactListRow {
  id: number;
  name: string | null;
  email: string | null;
  canonical_company_id: number | null;
  company_id: number | null; // back-compat alias for canonical_company_id
  company_name: string | null; // null for list rows (not joined); use detail query for this
  contact_type: string | null;
  risk_level: string | null;
  current_health_score: number | null;
  sentiment_score: number | null;
  last_activity: string | null;
  is_customer: boolean | null;
  is_supplier: boolean | null;
}

export interface ContactListPage {
  rows: ContactListRow[];
  total: number;
}

const CONTACT_SORT_MAP: Record<string, string> = {
  name: "display_name",
  email: "primary_email",
  health: "current_health_score",
  sentiment: "sentiment_score",
  activity: "last_activity_at",
  risk: "risk_level",
};

export interface ListContactsOptions {
  search?: string;
  limit?: number;
  offset?: number;
  canonicalCompanyId?: number;
  /** true = only contact_type starting with 'internal_' */
  onlyInternal?: boolean;
  /** true = exclude contact_type starting with 'internal_' */
  onlyExternal?: boolean;
}

export async function listContacts(
  opts: ListContactsOptions = {},
): Promise<ContactListRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("canonical_contacts")
    .select(
      "id, display_name, primary_email, canonical_company_id, contact_type, risk_level, current_health_score, sentiment_score, last_activity_at, is_customer, is_supplier",
    )
    .not("display_name", "is", null);

  if (opts.search) {
    const needle = opts.search.replace(/[%_]/g, "\\$&");
    q = q.or(
      `display_name.ilike.%${needle}%,primary_email.ilike.%${needle}%`,
    );
  }
  if (typeof opts.canonicalCompanyId === "number") {
    q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  }
  // is_internal partitioned by contact_type prefix
  if (opts.onlyInternal) {
    q = q.like("contact_type", "internal_%");
  } else if (opts.onlyExternal) {
    q = q.not("contact_type", "like", "internal_%");
  }

  q = q.order("display_name", { nullsFirst: false });
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset && opts.limit) {
    q = q.range(opts.offset, opts.offset + opts.limit - 1);
  }

  const { data, error } = await q;
  if (error) throw error;

  return ((data ?? []) as Array<{
    id: number;
    display_name: string | null;
    primary_email: string | null;
    canonical_company_id: number | null;
    contact_type: string | null;
    risk_level: string | null;
    current_health_score: number | null;
    sentiment_score: number | null;
    last_activity_at: string | null;
    is_customer: boolean | null;
    is_supplier: boolean | null;
  }>).map((r) => ({
    id: r.id,
    name: r.display_name,
    email: r.primary_email,
    canonical_company_id: r.canonical_company_id,
    company_id: r.canonical_company_id, // back-compat alias
    company_name: null, // not joined in list query
    contact_type: r.contact_type,
    risk_level: r.risk_level,
    current_health_score: r.current_health_score,
    sentiment_score: r.sentiment_score,
    last_activity: r.last_activity_at,
    is_customer: r.is_customer,
    is_supplier: r.is_supplier,
  }));
}

// Back-compat alias
export const searchContacts = listContacts;

// ──────────────────────────────────────────────────────────────────────────
// getContactsPage — paginated list (replaces legacy contacts table query)
// ──────────────────────────────────────────────────────────────────────────
export async function getContactsPage(
  params: TableParams & {
    risk?: string[];
    type?: string[];
  },
): Promise<ContactListPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && CONTACT_SORT_MAP[params.sort]) ?? "current_health_score";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("canonical_contacts")
    .select(
      "id, display_name, primary_email, canonical_company_id, contact_type, risk_level, current_health_score, sentiment_score, last_activity_at, is_customer, is_supplier",
      { count: "exact" },
    )
    .not("display_name", "is", null);

  if (params.q) {
    const needle = params.q.replace(/[%_]/g, "\\$&");
    query = query.or(
      `display_name.ilike.%${needle}%,primary_email.ilike.%${needle}%`,
    );
  }
  if (params.risk && params.risk.length > 0) {
    query = query.in("risk_level", params.risk);
  }
  if (params.type && params.type.length > 0) {
    const conditions: string[] = [];
    if (params.type.includes("customer")) conditions.push("is_customer.eq.true");
    if (params.type.includes("supplier")) conditions.push("is_supplier.eq.true");
    if (conditions.length > 0) query = query.or(conditions.join(","));
  }

  const { data, count, error } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  if (error) throw error;

  const rows = ((data ?? []) as Array<{
    id: number;
    display_name: string | null;
    primary_email: string | null;
    canonical_company_id: number | null;
    contact_type: string | null;
    risk_level: string | null;
    current_health_score: number | null;
    sentiment_score: number | null;
    last_activity_at: string | null;
    is_customer: boolean | null;
    is_supplier: boolean | null;
  }>).map((r) => ({
    id: r.id,
    name: r.display_name,
    email: r.primary_email,
    canonical_company_id: r.canonical_company_id,
    company_id: r.canonical_company_id, // back-compat alias
    company_name: null as string | null, // not joined in list query
    contact_type: r.contact_type,
    risk_level: r.risk_level,
    current_health_score: r.current_health_score,
    sentiment_score: r.sentiment_score,
    last_activity: r.last_activity_at,
    is_customer: r.is_customer,
    is_supplier: r.is_supplier,
  }));

  return { rows, total: count ?? rows.length };
}

// ──────────────────────────────────────────────────────────────────────────
// fetchContactById / getContactById
// ──────────────────────────────────────────────────────────────────────────
export async function fetchContactById(id: number): Promise<ContactDetail | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_contacts")
    .select("*, canonical_companies:canonical_company_id(display_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const r = data as Record<string, unknown>;
  const companyJoin = r.canonical_companies as
    | { display_name?: string | null }
    | { display_name?: string | null }[]
    | null;
  const companyName = Array.isArray(companyJoin)
    ? (companyJoin[0]?.display_name ?? null)
    : (companyJoin?.display_name ?? null);

  const insightsRes = await sb
    .from("agent_insights")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", String(id))
    .in("state", ["new", "seen"])
    .or(CEO_VISIBLE_FILTER);

  return {
    id: r.id as number,
    name: (r.display_name as string | null) ?? null,
    email: (r.primary_email as string | null) ?? null,
    canonical_company_id: (r.canonical_company_id as number | null) ?? null,
    // back-compat aliases for legacy consumers
    company_id: (r.canonical_company_id as number | null) ?? null,
    company_name: companyName,
    entity_id: (r.primary_entity_kg_id as string | null) ?? null,
    contact_type: (r.contact_type as string | null) ?? null,
    risk_level: (r.risk_level as string | null) ?? null,
    current_health_score: (r.current_health_score as number | null) ?? null,
    sentiment_score: (r.sentiment_score as number | null) ?? null,
    last_activity: (r.last_activity_at as string | null) ?? null,
    is_customer: (r.is_customer as boolean | null) ?? null,
    is_supplier: (r.is_supplier as boolean | null) ?? null,
    odoo_partner_id: (r.odoo_partner_id as number | null) ?? null,
    created_at: (r.created_at as string | null) ?? null,
    total_emails: 0, // email signals not yet linked to canonical_contacts
    active_insights: insightsRes.count ?? 0,
  };
}

// Back-compat alias
export const getContactById = fetchContactById;

// ──────────────────────────────────────────────────────────────────────────
// getContactDetail — replaces legacy contacts+company join
// ──────────────────────────────────────────────────────────────────────────
export interface ContactDetail {
  id: number;
  name: string | null;
  email: string | null;
  canonical_company_id: number | null;
  company_id: number | null; // back-compat alias for canonical_company_id
  company_name: string | null; // back-compat: resolved from canonical_companies.display_name
  entity_id: string | null; // back-compat: primary_entity_kg_id from canonical_contacts
  contact_type: string | null;
  risk_level: string | null;
  current_health_score: number | null;
  sentiment_score: number | null;
  last_activity: string | null;
  is_customer: boolean | null;
  is_supplier: boolean | null;
  odoo_partner_id: number | null;
  created_at: string | null;
  total_emails: number;
  active_insights: number;
}

export async function getContactDetail(
  id: string,
): Promise<ContactDetail | null> {
  // canonical_contacts PK is integer; accept string for back-compat
  const numId = parseInt(id, 10);
  if (Number.isNaN(numId)) return null;
  return fetchContactById(numId);
}

// ──────────────────────────────────────────────────────────────────────────
// getContactsKpis — list header KPIs
// ──────────────────────────────────────────────────────────────────────────
export interface ContactsKpis {
  total: number;
  customers: number;
  suppliers: number;
  atRisk: number;
  activeInsights: number;
}

export async function getContactsKpis(): Promise<ContactsKpis> {
  const sb = getServiceClient();
  const [total, customers, suppliers, atRisk, insights] = await Promise.all([
    sb
      .from("canonical_contacts")
      .select("id", { count: "exact", head: true })
      .not("display_name", "is", null),
    sb
      .from("canonical_contacts")
      .select("id", { count: "exact", head: true })
      .eq("is_customer", true),
    sb
      .from("canonical_contacts")
      .select("id", { count: "exact", head: true })
      .eq("is_supplier", true),
    sb
      .from("canonical_contacts")
      .select("id", { count: "exact", head: true })
      .in("risk_level", ["high", "critical"]),
    sb
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .not("contact_id", "is", null)
      .in("state", ["new", "seen"])
      .or(CEO_VISIBLE_FILTER),
  ]);

  return {
    total: total.count ?? 0,
    customers: customers.count ?? 0,
    suppliers: suppliers.count ?? 0,
    atRisk: atRisk.count ?? 0,
    activeInsights: insights.count ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// listEmployees — internal contacts only (replaces odoo_employees/odoo_users)
// ──────────────────────────────────────────────────────────────────────────
export async function listEmployees(
  opts: ListContactsOptions = {},
): Promise<ContactListRow[]> {
  return listContacts({ ...opts, onlyInternal: true });
}
