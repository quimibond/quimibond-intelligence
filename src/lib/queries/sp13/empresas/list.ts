import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { getNonZeroDriftSummary } from "@/lib/queries/canonical/company-drift";

/**
 * SP13 E5 — Lista completa de empresas con filtros / facets / paginacion.
 *
 * Fuente: gold_company_360 (view sobre canonical_companies).
 * Excluye Quimibond self (id=868) siempre.
 * Shadow companies (has_shadow_flag=true) se marcan pero NO se excluyen.
 *
 * Actividad:
 *   activa     = last_invoice_date >= NOW() - 12m
 *   dormida    = last_invoice_date < NOW() - 12m  O  last_invoice_date is null
 *   nueva_90d  = created_at (en canonical_companies) >= NOW() - 90 dias
 *
 * gold_company_360 no expone created_at, asi que para "nueva 90d" hacemos un
 * join-en-2-pasos: primero listamos canonical_companies.id con created_at
 * reciente y filtramos por ese set.
 */
export type CompanyTypeFilter = "cliente" | "proveedor" | "ambos" | "inactivo";
export type CompanyTierFilter = "A" | "B" | "C";
export type CompanyActivityFilter = "activa" | "dormida" | "nueva_90d";

export interface CompanyListParams {
  search?: string;
  type?: CompanyTypeFilter;
  tier?: CompanyTierFilter;
  activity?: CompanyActivityFilter;
  sort?:
    | "-ltv"
    | "-revenue_ytd"
    | "-overdue"
    | "-drift"
    | "-last_invoice"
    | "display_name";
  page?: number;
  limit?: number;
}

export interface CompanyListRow {
  canonical_company_id: number;
  display_name: string;
  rfc: string | null;
  is_customer: boolean;
  is_supplier: boolean;
  has_shadow_flag: boolean;
  blacklist_level: string | null;
  tier: string | null;
  lifetime_value_mxn: number;
  revenue_ytd_mxn: number;
  revenue_ltm_mxn: number;
  overdue_amount_mxn: number;
  last_invoice_date: string | null;
  drift_total_mxn: number;
  drift_needs_review: boolean;
}

export interface CompanyListResult {
  rows: CompanyListRow[];
  total: number;
  page: number;
  limit: number;
}

const QUIMIBOND_SELF_ID = 868;

const DEFAULT_LIMIT = 25;

function cutoff12mIso(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12);
  return d.toISOString();
}

function cutoff90dIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 90);
  return d.toISOString();
}

const SELECT_COLUMNS =
  "canonical_company_id, display_name, rfc, is_customer, is_supplier, has_shadow_flag, blacklist_level, tier, lifetime_value_mxn, revenue_ytd_mxn, revenue_90d_mxn, overdue_amount_mxn, last_invoice_date";

async function resolveRecentlyCreatedIds(): Promise<number[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("canonical_companies")
    .select("id")
    .gte("created_at", cutoff90dIso())
    .neq("id", QUIMIBOND_SELF_ID);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
}

export async function getCompaniesPage(
  params: CompanyListParams = {},
): Promise<CompanyListResult> {
  const sb = getServiceClient();
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(5, params.limit ?? DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = sb
    .from("gold_company_360")
    .select(SELECT_COLUMNS, { count: "exact" })
    .neq("canonical_company_id", QUIMIBOND_SELF_ID);

  // Search on display_name OR rfc
  if (params.search && params.search.trim().length > 0) {
    const s = params.search.trim();
    q = q.or(`display_name.ilike.%${s}%,rfc.ilike.%${s}%`);
  }

  // Tipo filter
  switch (params.type) {
    case "cliente":
      q = q.eq("is_customer", true).eq("is_supplier", false);
      break;
    case "proveedor":
      q = q.eq("is_supplier", true).eq("is_customer", false);
      break;
    case "ambos":
      q = q.eq("is_customer", true).eq("is_supplier", true);
      break;
    case "inactivo":
      q = q.eq("is_customer", false).eq("is_supplier", false);
      break;
  }

  // Tier filter
  if (params.tier) {
    q = q.eq("tier", params.tier);
  }

  // Actividad filter
  const cutoff = cutoff12mIso();
  if (params.activity === "activa") {
    q = q.gte("last_invoice_date", cutoff);
  } else if (params.activity === "dormida") {
    q = q.or(`last_invoice_date.lt.${cutoff},last_invoice_date.is.null`);
  } else if (params.activity === "nueva_90d") {
    const recentIds = await resolveRecentlyCreatedIds();
    if (recentIds.length === 0) {
      return { rows: [], total: 0, page, limit };
    }
    q = q.in("canonical_company_id", recentIds);
  }

  // Sort
  const sort = params.sort ?? "-ltv";
  switch (sort) {
    case "-revenue_ytd":
      q = q.order("revenue_ytd_mxn", { ascending: false, nullsFirst: false });
      break;
    case "-overdue":
      q = q.order("overdue_amount_mxn", { ascending: false, nullsFirst: false });
      break;
    case "-last_invoice":
      q = q.order("last_invoice_date", { ascending: false, nullsFirst: false });
      break;
    case "display_name":
      q = q.order("display_name", { ascending: true });
      break;
    case "-drift":
      // drift sort cannot happen at DB level (column lives in canonical_companies
      // not gold_company_360). Fall back to LTV order and sort client-side after
      // drift is merged.
      q = q.order("lifetime_value_mxn", { ascending: false, nullsFirst: false });
      break;
    case "-ltv":
    default:
      q = q.order("lifetime_value_mxn", { ascending: false, nullsFirst: false });
      break;
  }

  // Run list + drift map in parallel
  const [listRes, driftMap] = await Promise.all([
    q.range(from, to),
    getNonZeroDriftSummary().catch(() => ({}) as Record<number, { total_abs_mxn: number; needs_review: boolean }>),
  ]);

  if (listRes.error) throw listRes.error;

  type RawRow = {
    canonical_company_id: number | null;
    display_name: string | null;
    rfc: string | null;
    is_customer: boolean | null;
    is_supplier: boolean | null;
    has_shadow_flag: boolean | null;
    blacklist_level: string | null;
    tier: string | null;
    lifetime_value_mxn: number | null;
    revenue_ytd_mxn: number | null;
    revenue_90d_mxn: number | null;
    overdue_amount_mxn: number | null;
    last_invoice_date: string | null;
  };

  const rawRows = (listRes.data ?? []) as RawRow[];

  // Real LTM per visible company: aggregate gold_revenue_monthly.resolved_mxn
  // for the last 12 months. Bounded to the visible page (≤100 rows) so this
  // adds one extra roundtrip with a small IN-list, not a 4k-row scan.
  const visibleIds = rawRows
    .map((r) => r.canonical_company_id)
    .filter((n): n is number => typeof n === "number");
  const ltmByCompany = new Map<number, number>();
  if (visibleIds.length > 0) {
    const ltmFrom = new Date();
    ltmFrom.setUTCFullYear(ltmFrom.getUTCFullYear() - 1);
    ltmFrom.setUTCDate(1);
    const ltmFromIso = ltmFrom.toISOString().slice(0, 10);
    const { data: ltmRows } = await sb
      .from("gold_revenue_monthly")
      .select("canonical_company_id, resolved_mxn")
      .in("canonical_company_id", visibleIds)
      .gte("month_start", ltmFromIso);
    for (const r of (ltmRows ?? []) as Array<{
      canonical_company_id: number | null;
      resolved_mxn: number | null;
    }>) {
      if (r.canonical_company_id == null) continue;
      ltmByCompany.set(
        r.canonical_company_id,
        (ltmByCompany.get(r.canonical_company_id) ?? 0) +
          (Number(r.resolved_mxn) || 0),
      );
    }
  }

  const rows: CompanyListRow[] = rawRows.map((r) => {
    const id = r.canonical_company_id as number;
    const drift = driftMap[id];
    return {
      canonical_company_id: id,
      display_name: r.display_name ?? "—",
      rfc: r.rfc ?? null,
      is_customer: Boolean(r.is_customer),
      is_supplier: Boolean(r.is_supplier),
      has_shadow_flag: Boolean(r.has_shadow_flag),
      blacklist_level: r.blacklist_level,
      tier: r.tier,
      lifetime_value_mxn: Number(r.lifetime_value_mxn) || 0,
      revenue_ytd_mxn: Number(r.revenue_ytd_mxn) || 0,
      // Real LTM from gold_revenue_monthly (resolved_mxn = SAT preferred,
      // Odoo fallback). Replaces the legacy 90d * 4 proxy that under-stated
      // by ~15-25% due to seasonality.
      revenue_ltm_mxn: ltmByCompany.get(id) ?? 0,
      overdue_amount_mxn: Number(r.overdue_amount_mxn) || 0,
      last_invoice_date: r.last_invoice_date,
      drift_total_mxn: drift?.total_abs_mxn ?? 0,
      drift_needs_review: Boolean(drift?.needs_review),
    };
  });

  if (sort === "-drift") {
    rows.sort((a, b) => b.drift_total_mxn - a.drift_total_mxn);
  }

  return {
    rows,
    total: listRes.count ?? rows.length,
    page,
    limit,
  };
}
