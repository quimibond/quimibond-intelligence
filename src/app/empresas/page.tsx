import { Suspense } from "react";
import { z } from "zod";
import { Building2, DollarSign, ShieldAlert, Users } from "lucide-react";
import {
  PageLayout,
  PageHeader,
  StatGrid,
  KpiCard,
  LoadingList,
} from "@/components/patterns";
import { parseSearchParams } from "@/lib/url-state";
import {
  listCompanies,
  fetchPortfolioKpis,
} from "@/lib/queries/_shared/companies";
import { getNonZeroDriftSummary } from "@/lib/queries/canonical/company-drift";
import { CompanyFilterBar } from "./_components/CompanyFilterBar";
import {
  CompanyListClient,
  type CompanyListRow,
} from "./_components/CompanyListClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Empresas" };

const searchSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  type: z.enum(["customer", "supplier", "all"]).catch("all"),
  blacklist: z
    .enum(["none", "any", "69b_presunto", "69b_definitivo"])
    .catch("any"),
  shadowOnly: z.coerce.boolean().catch(false),
  sort: z
    .enum([
      "-ltv_mxn",
      "-revenue_ytd_mxn",
      "-overdue_amount_mxn",
      "-open_company_issues_count",
      "-drift_total_mxn",
      "display_name",
    ])
    .catch("-ltv_mxn"),
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(10).max(200).catch(50),
});

function fmtMxn(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = parseSearchParams(raw, searchSchema);

  // Fetch all three in parallel. getNonZeroDriftSummary is id-list-free
  // (pulls every company with non-zero drift in one shot, typically
  // ~100-300 rows) so it runs alongside listCompanies instead of after it,
  // saving one round-trip on every /empresas render.
  const [kpis, rows, driftMap] = await Promise.all([
    fetchPortfolioKpis(),
    listCompanies({
      search: params.q || undefined,
      onlyCustomers: params.type === "customer",
      onlySuppliers: params.type === "supplier",
      blacklistLevel:
        params.blacklist === "any" ? undefined : params.blacklist,
      limit: params.limit,
      offset: (params.page - 1) * params.limit,
    }),
    getNonZeroDriftSummary().catch(
      () => ({}) as Record<number, { total_abs_mxn: number; needs_review: boolean }>,
    ),
  ]);

  const filteredRaw = params.shadowOnly
    ? rows.filter((r) => Boolean(r.has_shadow_flag))
    : rows;

  const filtered: CompanyListRow[] = filteredRaw.map((r) => {
    const d = driftMap[r.canonical_company_id];
    return {
      ...r,
      drift_total_mxn: d?.total_abs_mxn ?? 0,
      drift_needs_review: d?.needs_review ?? false,
    } as CompanyListRow;
  });

  const sortKey = params.sort;
  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "-ltv_mxn":
        return (b.lifetime_value_mxn ?? 0) - (a.lifetime_value_mxn ?? 0);
      case "-revenue_ytd_mxn":
        return (b.revenue_ytd_mxn ?? 0) - (a.revenue_ytd_mxn ?? 0);
      case "-overdue_amount_mxn":
        return (b.overdue_amount_mxn ?? 0) - (a.overdue_amount_mxn ?? 0);
      case "-open_company_issues_count":
        return (
          (b.open_company_issues_count ?? 0) -
          (a.open_company_issues_count ?? 0)
        );
      case "-drift_total_mxn":
        return (b.drift_total_mxn ?? 0) - (a.drift_total_mxn ?? 0);
      case "display_name":
        return (a.display_name ?? "").localeCompare(b.display_name ?? "");
    }
  });

  const hasFilters =
    params.q.length > 0 ||
    params.type !== "all" ||
    params.blacklist !== "any" ||
    params.shadowOnly ||
    params.sort !== "-ltv_mxn";

  return (
    <PageLayout>
      <PageHeader
        title="Empresas"
        subtitle="Portfolio de clientes + proveedores"
      />
      <StatGrid columns={{ mobile: 2, desktop: 4 }}>
        <KpiCard
          icon={DollarSign}
          title="LTV total"
          value={fmtMxn(kpis.lifetime_value_mxn_total)}
        />
        <KpiCard
          icon={Users}
          title="Clientes"
          value={kpis.customers_count.toLocaleString("es-MX")}
        />
        <KpiCard
          icon={Building2}
          title="Proveedores"
          value={kpis.suppliers_count.toLocaleString("es-MX")}
        />
        <KpiCard
          icon={ShieldAlert}
          title="Lista negra"
          value={kpis.blacklist_count.toLocaleString("es-MX")}
        />
      </StatGrid>
      <CompanyFilterBar params={params} />
      <Suspense fallback={<LoadingList />}>
        <CompanyListClient items={sorted} hasFilters={hasFilters} />
      </Suspense>
    </PageLayout>
  );
}
