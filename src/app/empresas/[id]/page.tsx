import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { z } from "zod";

import { PageLayout, PageHeader } from "@/components/patterns";
import { CompanyKpiHero } from "@/components/patterns/company-kpi-hero";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { parseSearchParams } from "@/lib/url-state";

import {
  fetchCompanyById,
  fetchCompany360,
  fetchCompanyRevenueTrend,
  fetchCompanyReceivables,
  getCompanyDetail,
  getCompanyOrders,
  getCompanyRecentInsights,
} from "@/lib/queries/_shared/companies";

import { TabPicker, type TabKey } from "./_components/TabPicker";
import { PanoramaTab } from "./_components/PanoramaTab";
import { ComercialTab } from "./_components/ComercialTab";
import { FinancieroTab } from "./_components/FinancieroTab";
import { OperativoTab } from "./_components/OperativoTab";
import { FiscalTab } from "./_components/FiscalTab";
import { PagosTab } from "./_components/PagosTab";
import { AuditoriaSatTab } from "./_components/AuditoriaSatTab";
import {
  getCompanyDrift,
  getCompanyDriftRows,
  shouldShowDriftTab,
} from "@/lib/queries/canonical/company-drift";

export const dynamic = "force-dynamic";

const detailSchema = z.object({
  tab: z
    .enum([
      "panorama",
      "comercial",
      "financiero",
      "operativo",
      "fiscal",
      "pagos",
      "auditoria_sat",
    ])
    .catch("panorama"),
});

const BASE_TAB_ORDER: TabKey[] = [
  "panorama",
  "comercial",
  "financiero",
  "operativo",
  "fiscal",
  "pagos",
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const canonical = await fetchCompanyById(Number(id));
  return { title: canonical?.display_name ?? "Empresa" };
}

function toAgingData(
  receivables: Array<{
    fiscal_days_to_due_date: number | null;
    amount_residual_mxn_odoo: number | null;
  }>
): {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
} {
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const r of receivables) {
    const days = r.fiscal_days_to_due_date;
    const amount = r.amount_residual_mxn_odoo ?? 0;
    if (amount <= 0) continue;
    if (days == null || days >= 0) buckets.current += amount;
    else if (days >= -30) buckets.d1_30 += amount;
    else if (days >= -60) buckets.d31_60 += amount;
    else if (days >= -90) buckets.d61_90 += amount;
    else buckets.d90_plus += amount;
  }
  return buckets;
}

export default async function EmpresaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  const raw = await searchParams;
  const { tab } = parseSearchParams(raw, detailSchema);

  const [
    canonical,
    c360,
    trend,
    receivables,
    legacyDetail,
    driftAggregates,
    recentOrdersRaw,
    recentInsights,
  ] = await Promise.all([
    fetchCompanyById(id),
    fetchCompany360(id),
    fetchCompanyRevenueTrend(id, 12).catch(
      () => [] as Array<{ month_start: string; total_mxn: number }>,
    ),
    fetchCompanyReceivables(id).catch(
      () =>
        [] as Array<{
          fiscal_days_to_due_date: number | null;
          amount_residual_mxn_odoo: number | null;
        }>,
    ),
    getCompanyDetail(id).catch(() => null),
    // Drift fields may be null on empresas recién creadas where the hourly
    // refresh job hasn't computed the aggregates yet — swallow errors so
    // the rest of the page still renders (see memory feedback_server_component_top_level_throws).
    getCompanyDrift(id).catch(() => null),
    getCompanyOrders(id, 3).catch(() => []),
    getCompanyRecentInsights(id, 5).catch(() => []),
  ]);

  if (!canonical || !c360) notFound();

  // Empresas internas (self) no tienen análisis comercial
  if (legacyDetail?.isSelf) {
    return (
      <PageLayout>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Empresas", href: "/empresas" },
            { label: canonical.display_name ?? "Empresa" },
          ]}
          title={canonical.display_name ?? "Empresa"}
          subtitle="Empresa interna"
          actions={<Badge variant="secondary">Interna</Badge>}
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="size-10 text-muted-foreground" />
            <h3 className="text-base font-semibold">Esta es una empresa interna</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {canonical.display_name} está marcada como{" "}
              <code className="rounded bg-muted px-1">relationship_type=self</code>{" "}
              — no aplica análisis comercial (revenue, cartera, reorder, etc.). Las
              empresas externas se ven en{" "}
              <Link href="/empresas" className="underline hover:text-primary">
                /empresas
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const aging = toAgingData(receivables);

  const recentSaleOrders = recentOrdersRaw.map((o) => ({
    canonical_id: String(o.id),
    name: o.name,
    amount_total_mxn: o.amount_total_mxn,
    date_order: o.date_order,
  }));

  const recentEvidence = recentInsights.map((i) => ({
    kind: "fact" as const,
    key: `insight-${i.id}`,
    title: i.title,
    body:
      [
        i.severity ? `Severidad ${i.severity}` : null,
        i.category ? `· ${i.category}` : null,
        i.state ? `· ${i.state}` : null,
      ]
        .filter(Boolean)
        .join(" ") || "Insight del sistema",
    at: i.created_at ?? "",
  }));

  const newTabDetail = {
    aging,
    revenueTrend: trend,
    recentSaleOrders,
    recentEvidence,
    overdue_amount_mxn: c360.overdue_amount_mxn ?? 0,
    lifetime_value_mxn: c360.lifetime_value_mxn ?? 0,
    revenue_90d_mxn: c360.revenue_90d_mxn ?? 0,
  };

  const canonicalForHero = {
    id: canonical.id,
    display_name: canonical.display_name ?? "",
    rfc: canonical.rfc ?? null,
    has_shadow_flag: Boolean(canonical.has_shadow_flag),
    blacklist_level: (canonical.blacklist_level ?? "none") as
      | "none"
      | "69b_presunto"
      | "69b_definitivo",
  };

  const c360ForHero = {
    canonical_company_id: c360.canonical_company_id ?? id,
    lifetime_value_mxn: c360.lifetime_value_mxn ?? 0,
    revenue_ytd_mxn: c360.revenue_ytd_mxn ?? 0,
    overdue_amount_mxn: c360.overdue_amount_mxn ?? 0,
    open_company_issues_count: c360.open_company_issues_count ?? 0,
    revenue_90d_mxn: c360.revenue_90d_mxn ?? 0,
  };

  const trendSeries = (trend ?? []).map((t) => t.total_mxn ?? 0);

  const showDriftTab = shouldShowDriftTab(driftAggregates);
  const visibleTabs: TabKey[] = showDriftTab
    ? [...BASE_TAB_ORDER, "auditoria_sat"]
    : BASE_TAB_ORDER;

  // Clamp the active tab to what's visible — if the URL asks for "auditoria_sat"
  // but the company has no drift, fall back to panorama instead of rendering
  // an orphan panel.
  const activeTab: TabKey = visibleTabs.includes(tab) ? tab : "panorama";

  const driftRows =
    showDriftTab && activeTab === "auditoria_sat"
      ? await getCompanyDriftRows(id).catch(() => [])
      : [];

  return (
    <PageLayout>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Empresas", href: "/empresas" },
          { label: canonical.display_name ?? "Empresa" },
        ]}
        title=""
      />
      <CompanyKpiHero
        canonical={canonicalForHero}
        company360={c360ForHero}
        trend={trendSeries}
      />
      <TabPicker activeTab={activeTab} tabs={visibleTabs} />
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        {activeTab === "panorama" && <PanoramaTab detail={newTabDetail} />}
        {activeTab === "financiero" && <FinancieroTab detail={newTabDetail} />}
        {/* Legacy tabs — use their current prop signatures */}
        {activeTab === "comercial" && legacyDetail && (
          <ComercialTab company={legacyDetail} searchParams={raw} />
        )}
        {activeTab === "operativo" && legacyDetail && (
          <OperativoTab company={legacyDetail} searchParams={raw} />
        )}
        {activeTab === "fiscal" && <FiscalTab companyId={id} />}
        {activeTab === "pagos" && legacyDetail && (
          <PagosTab company={legacyDetail} />
        )}
        {activeTab === "auditoria_sat" && driftAggregates && (
          <AuditoriaSatTab aggregates={driftAggregates} rows={driftRows} />
        )}
      </Suspense>
    </PageLayout>
  );
}
