import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { paginationRange, type TableParams } from "./table-params";
import { CEO_VISIBLE_FILTER } from "../intelligence/insights";

/**
 * Contacts queries — personas físicas linkeadas a companies / entities.
 * Se usan para:
 *  - Lista de contactos con health score + riesgo
 *  - Detalle con actividad, emails, insights relacionados
 */

export interface ContactListRow {
  id: string;
  name: string | null;
  email: string | null;
  company_id: number | null;
  company_name: string | null;
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
  name: "name",
  email: "email",
  health: "current_health_score",
  sentiment: "sentiment_score",
  activity: "last_activity",
  risk: "risk_level",
};

export async function getContactsPage(
  params: TableParams & {
    risk?: string[];
    type?: string[];
  }
): Promise<ContactListPage> {
  const sb = getServiceClient();
  const [start, end] = paginationRange(params.page, params.size);
  const sortCol =
    (params.sort && CONTACT_SORT_MAP[params.sort]) ?? "current_health_score";
  const ascending = params.sortDir === "asc";

  let query = sb
    .from("contacts")
    .select(
      "id, name, email, company_id, risk_level, current_health_score, sentiment_score, last_activity, is_customer, is_supplier, companies:company_id(name)",
      { count: "exact" }
    )
    .not("name", "is", null);

  if (params.q) {
    const needle = params.q.replace(/[%_]/g, "\\$&");
    query = query.or(
      `name.ilike.%${needle}%,email.ilike.%${needle}%`
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

  const { data, count } = await query
    .order(sortCol, { ascending, nullsFirst: false })
    .range(start, end);

  type Raw = Omit<ContactListRow, "company_name"> & { companies: unknown };
  const rows = ((data ?? []) as unknown as Raw[]).map((r) => {
    const joined = r.companies as { name?: string | null } | { name?: string | null }[] | null;
    const companyName = Array.isArray(joined)
      ? (joined[0]?.name ?? null)
      : (joined?.name ?? null);
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      company_id: r.company_id,
      company_name: companyName,
      risk_level: r.risk_level,
      current_health_score: r.current_health_score,
      sentiment_score: r.sentiment_score,
      last_activity: r.last_activity,
      is_customer: r.is_customer,
      is_supplier: r.is_supplier,
    };
  });

  return { rows, total: count ?? rows.length };
}

// ──────────────────────────────────────────────────────────────────────────
// Contact detail
// ──────────────────────────────────────────────────────────────────────────
export interface ContactDetail {
  id: string;
  name: string | null;
  email: string | null;
  company_id: number | null;
  company_name: string | null;
  entity_id: string | null;
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
  id: string
): Promise<ContactDetail | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("contacts")
    .select(
      "id, name, email, company_id, entity_id, risk_level, current_health_score, sentiment_score, last_activity, is_customer, is_supplier, odoo_partner_id, created_at, companies:company_id(name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;

  const [emailsRes, insightsRes] = await Promise.all([
    sb
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("sender_contact_id", id),
    sb
      .from("agent_insights")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id)
      .in("state", ["new", "seen"])
      .or(CEO_VISIBLE_FILTER),
  ]);

  const joined = (data as { companies?: { name?: string | null } | { name?: string | null }[] | null }).companies;
  const companyName = Array.isArray(joined)
    ? (joined[0]?.name ?? null)
    : (joined?.name ?? null);

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    company_id: data.company_id,
    company_name: companyName,
    entity_id: data.entity_id,
    risk_level: data.risk_level,
    current_health_score: data.current_health_score,
    sentiment_score: data.sentiment_score,
    last_activity: data.last_activity,
    is_customer: data.is_customer,
    is_supplier: data.is_supplier,
    odoo_partner_id: data.odoo_partner_id,
    created_at: data.created_at,
    total_emails: emailsRes.count ?? 0,
    active_insights: insightsRes.count ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Contact-level KPIs for the list header
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
    sb.from("contacts").select("id", { count: "exact", head: true }).not("name", "is", null),
    sb
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("is_customer", true),
    sb
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("is_supplier", true),
    sb
      .from("contacts")
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
