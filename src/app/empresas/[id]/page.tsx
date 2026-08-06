/**
 * Ficha 360 de empresa (rediseño 2026-08-06, fase B de "todo conectado").
 *
 * Antes: 8 tabs excluyentes vía ?tab= — quién es, qué debe, qué compró y
 * qué dijo vivían en pantallas separadas. Ahora: UNA página scrolleable
 * con anclas (SectionNav) donde todo convive; cada sección reutiliza el
 * componente de la tab original y carga en su propio Suspense.
 *
 * Cambios de fondo:
 * - FinancieroTab eliminado del render: duplicaba Panorama (mismo aging,
 *   mismo trend). Sus MetricRows viven ahora en la sección Salud.
 * - Sección "Salud" nueva: tier, riesgo, OTD, máx días vencido, señales —
 *   campos de gold_company_360 que ya se fetcheaban y se descartaban.
 * - ?tab= se ignora (los ~33 links entrantes apuntan a la raíz).
 */

import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";

import { KpiCard, PageLayout, PageHeader, SectionNav, StatGrid } from "@/components/patterns";
import { CompanyKpiHero } from "@/components/patterns/company-kpi-hero";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  fetchCompanyById,
  fetchCompany360,
  fetchCompanyRevenueTrend,
  fetchCompanyReceivables,
  getCompanyDetail,
  getCompanyOrders,
  getCompanyRecentInsights,
} from "@/lib/queries/_shared/companies";

import { PanoramaTab } from "./_components/PanoramaTab";
import { ComercialTab } from "./_components/ComercialTab";
import { OperativoTab } from "./_components/OperativoTab";
import { FiscalTab } from "./_components/FiscalTab";
import { PagosTab } from "./_components/PagosTab";
import { AuditoriaSatTab } from "./_components/AuditoriaSatTab";
import { CommsTimeline } from "@/components/comms/CommsTimeline";
import {
  getCompanyDrift,
  getCompanyDriftRows,
  shouldShowDriftTab,
} from "@/lib/queries/canonical/company-drift";

export const dynamic = "force-dynamic";

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

const RISK_LABEL: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
};

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
    // the rest of the page still renders.
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

  const showDrift = shouldShowDriftTab(driftAggregates);
  const driftRows = showDrift ? await getCompanyDriftRows(id).catch(() => []) : [];

  const riskSignals = Array.isArray(c360.risk_signals)
    ? (c360.risk_signals as unknown[]).map(String).slice(0, 5)
    : [];

  const sections = [
    { id: "salud", label: "Salud" },
    { id: "panorama", label: "Panorama" },
    { id: "comercial", label: "Comercial" },
    { id: "operativo", label: "Operativo" },
    { id: "pagos", label: "Pagos" },
    { id: "comunicaciones", label: "Comunicación" },
    { id: "fiscal", label: "Fiscal" },
    ...(showDrift ? [{ id: "auditoria-sat", label: "Auditoría SAT" }] : []),
  ];

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
      <SectionNav items={sections} />

      <section id="salud" className="scroll-mt-24 space-y-3">
        <h2 className="text-base font-semibold">Salud de la relación</h2>
        <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 6 }}>
          <KpiCard title="Tier" value={c360.tier ?? "—"} size="sm" />
          <KpiCard
            title="Riesgo"
            value={RISK_LABEL[c360.risk_level ?? ""] ?? (c360.risk_level || "—")}
            size="sm"
            tone={
              c360.risk_level === "critical" || c360.risk_level === "high"
                ? "danger"
                : c360.risk_level === "medium"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            title="OTD 90 días"
            value={c360.otd_rate_90d}
            format="percent"
            size="sm"
            tone={c360.otd_rate_90d != null && c360.otd_rate_90d < 80 ? "danger" : "default"}
          />
          <KpiCard
            title="Máx días vencido"
            value={c360.max_days_overdue}
            format="number"
            size="sm"
            tone={(c360.max_days_overdue ?? 0) > 60 ? "danger" : "default"}
          />
          <KpiCard
            title="Última factura"
            value={c360.last_invoice_date ?? "—"}
            size="sm"
          />
          <KpiCard
            title="Último email"
            value={c360.last_email_at ? String(c360.last_email_at).slice(0, 10) : "—"}
            size="sm"
            subtitle={c360.email_count != null ? `${c360.email_count} emails` : undefined}
          />
        </StatGrid>
        {riskSignals.length > 0 && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {riskSignals.map((s) => (
              <li key={s}>⚠️ {s}</li>
            ))}
          </ul>
        )}
      </section>

      <section id="panorama" className="scroll-mt-24 space-y-3">
        <h2 className="text-base font-semibold">Panorama</h2>
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <PanoramaTab detail={newTabDetail} />
        </Suspense>
      </section>

      {legacyDetail && (
        <section id="comercial" className="scroll-mt-24 space-y-3">
          <h2 className="text-base font-semibold">Comercial — qué compra</h2>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <ComercialTab company={legacyDetail} searchParams={raw} />
          </Suspense>
        </section>
      )}

      {legacyDetail && (
        <section id="operativo" className="scroll-mt-24 space-y-3">
          <h2 className="text-base font-semibold">Operativo — entregas y actividades</h2>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <OperativoTab company={legacyDetail} searchParams={raw} />
          </Suspense>
        </section>
      )}

      {legacyDetail && (
        <section id="pagos" className="scroll-mt-24 space-y-3">
          <h2 className="text-base font-semibold">Pagos recibidos</h2>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <PagosTab company={legacyDetail} />
          </Suspense>
        </section>
      )}

      <section id="comunicaciones" className="scroll-mt-24 space-y-3">
        <h2 className="text-base font-semibold">Comunicación</h2>
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <CommsTimeline entityType="company" entityId={id} searchParams={raw} />
        </Suspense>
      </section>

      <section id="fiscal" className="scroll-mt-24 space-y-3">
        <h2 className="text-base font-semibold">Fiscal (SAT)</h2>
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <FiscalTab companyId={id} />
        </Suspense>
      </section>

      {showDrift && driftAggregates && (
        <section id="auditoria-sat" className="scroll-mt-24 space-y-3">
          <h2 className="text-base font-semibold">Auditoría SAT ↔ Odoo</h2>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <AuditoriaSatTab aggregates={driftAggregates} rows={driftRows} />
          </Suspense>
        </section>
      )}
    </PageLayout>
  );
}
