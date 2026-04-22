// src/app/showcase/page.tsx
// Internal route — not listed in sidebar. Used by Playwright e2e for screenshot
// baseline + axe-core a11y scan.
import { Suspense } from "react";
import {
  PageLayout,
  PageHeader,
  StatusBadge,
  Chart,
  TrendSpark,
  InboxCard,
  SwipeStack,
  AgingBuckets,
  CompanyKpiHero,
  LoadingCard,
} from "@/components/patterns";
import type { InboxCardIssue, InboxActionCta, InboxCardSeverity } from "@/components/patterns";
import type { AgingData } from "@/components/patterns";
import { listInbox } from "@/lib/queries/intelligence/inbox";
import { fetchCompanyById, fetchCompany360 } from "@/lib/queries/_shared/companies";
import { fetchTopCustomers } from "@/lib/queries/analytics/customer-360";
import { invoicesReceivableAging } from "@/lib/queries/unified/invoices";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "SP6 Showcase (internal)" };

// ──────────────────────────────────────────────────────────────────────────
// Adapters — map helper return shapes → component prop shapes
// ──────────────────────────────────────────────────────────────────────────

/**
 * gold_ceo_inbox returns flat assignee fields (assignee_canonical_contact_id,
 * assignee_name, assignee_email) rather than a nested object.
 * InboxCardIssue expects assignee: { id, name, email } | null.
 * Also all numeric/string DB columns are nullable; coerce to required types.
 */
function adaptInboxRow(r: {
  issue_id: string | null;
  issue_type: string | null;
  severity: string | null;
  priority_score: number | null;
  impact_mxn: number | null;
  age_days: number | null;
  description: string | null;
  canonical_entity_type: string | null;
  canonical_entity_id: string | null;
  action_cta: string | null;
  detected_at: string | null;
  assignee_canonical_contact_id: number | null;
  assignee_name: string | null;
  assignee_email: string | null;
}): InboxCardIssue {
  return {
    issue_id: r.issue_id ?? "unknown",
    issue_type: r.issue_type ?? "",
    severity: (r.severity ?? "medium") as InboxCardSeverity,
    priority_score: r.priority_score ?? 0,
    impact_mxn: r.impact_mxn,
    age_days: r.age_days ?? 0,
    description: r.description ?? "",
    canonical_entity_type: r.canonical_entity_type ?? "",
    canonical_entity_id: r.canonical_entity_id ?? "",
    action_cta: (r.action_cta ?? null) as InboxActionCta | null,
    detected_at: r.detected_at ?? new Date().toISOString(),
    assignee:
      r.assignee_canonical_contact_id != null && r.assignee_name != null
        ? {
            id: r.assignee_canonical_contact_id,
            name: r.assignee_name,
            email: r.assignee_email ?? "",
          }
        : null,
  };
}

/**
 * invoicesReceivableAging() returns bucket keys "1-30", "31-60", "61-90", "90+"
 * but AgingData expects d1_30, d31_60, d61_90, d90_plus.
 */
function adaptAgingData(raw: Record<string, number>): AgingData {
  return {
    current: raw["current"] ?? 0,
    d1_30: raw["1-30"] ?? 0,
    d31_60: raw["31-60"] ?? 0,
    d61_90: raw["61-90"] ?? 0,
    d90_plus: raw["90+"] ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Async demo components
// ──────────────────────────────────────────────────────────────────────────

async function InboxCardDemo() {
  const rows = await listInbox({ limit: 3 });
  return (
    <SwipeStack ariaLabel="Demo de InboxCard" snap={false}>
      {rows.map((r, i) => (
        <InboxCard key={r.issue_id ?? i} issue={adaptInboxRow(r)} />
      ))}
    </SwipeStack>
  );
}

async function AgingDemo() {
  const aging = await invoicesReceivableAging();
  return (
    <AgingBuckets
      data={adaptAgingData(aging as unknown as Record<string, number>)}
      ariaLabel="Aging de cartera (real)"
    />
  );
}

async function TopCustomerHero() {
  const top = await fetchTopCustomers({ limit: 1 });
  const company = top[0];
  if (!company) return <div>Sin clientes</div>;
  const canonicalCompanyId = company.canonical_company_id;
  if (!canonicalCompanyId) return <div>Sin ID canonical</div>;
  const [canonical, c360] = await Promise.all([
    fetchCompanyById(canonicalCompanyId),
    fetchCompany360(canonicalCompanyId),
  ]);
  if (!canonical || !c360) return <div>Datos incompletos</div>;
  return (
    <CompanyKpiHero
      canonical={canonical as never} // TODO sp6-01-types: tighten when DB types synced
      company360={c360 as never}     // TODO sp6-01-types: tighten when DB types synced
      trend={[100, 120, 135, 155, 180, 210]}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Static showcase (no network calls)
// ──────────────────────────────────────────────────────────────────────────

function StaticShowcase() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">StatusBadge · density=compact</h2>
        <div className="flex flex-wrap gap-3">
          <StatusBadge kind="severity" value="critical" />
          <StatusBadge kind="severity" value="high" />
          <StatusBadge kind="severity" value="medium" />
          <StatusBadge kind="severity" value="low" />
          <StatusBadge kind="payment" value="paid" />
          <StatusBadge kind="payment" value="partial" />
          <StatusBadge kind="payment" value="not_paid" />
          <StatusBadge kind="estado_sat" value="vigente" />
          <StatusBadge kind="estado_sat" value="cancelado" />
          <StatusBadge kind="blacklist" value="69b_definitivo" />
          <StatusBadge kind="shadow" value={true} />
          <StatusBadge kind="staleness" value="stale" />
          <StatusBadge kind="match" value={0.95} />
          <StatusBadge kind="match" value={0.75} />
          <StatusBadge kind="match" value={0.3} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">StatusBadge · density=regular</h2>
        <div className="flex flex-wrap gap-3">
          <StatusBadge kind="severity" value="critical" density="regular" />
          <StatusBadge kind="payment" value="paid" density="regular" />
          <StatusBadge kind="blacklist" value="69b_presunto" density="regular" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">TrendSpark</h2>
        <div className="flex gap-4 items-center">
          <span className="text-sm">Up:</span>
          <TrendSpark values={[10, 20, 35, 55, 80]} ariaLabel="Up trend" />
          <span className="text-sm">Down:</span>
          <TrendSpark values={[80, 55, 35, 20, 10]} ariaLabel="Down trend" />
          <span className="text-sm">Flat:</span>
          <TrendSpark values={[50, 50, 50, 50]} ariaLabel="Flat trend" />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Chart — line + bar</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Chart
            type="line"
            data={[
              { m: "Ene", v: 100 },
              { m: "Feb", v: 120 },
              { m: "Mar", v: 150 },
              { m: "Abr", v: 180 },
            ]}
            xKey="m"
            series={[{ key: "v", label: "Ingresos", color: "positive" }]}
            ariaLabel="Demo line chart"
          />
          <Chart
            type="bar"
            data={[
              { m: "Ene", v: 60 },
              { m: "Feb", v: 45 },
              { m: "Mar", v: 90 },
            ]}
            xKey="m"
            series={[{ key: "v", label: "Gastos", color: "warning" }]}
            ariaLabel="Demo bar chart"
          />
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function ShowcasePage() {
  return (
    <PageLayout>
      <PageHeader
        title="SP6 Showcase"
        subtitle="Componentes nuevos y consolidados con datos reales — ruta interna, no listado en sidebar."
      />
      <StaticShowcase />
      <section>
        <h2 className="text-lg font-semibold mb-3">InboxCard (datos reales)</h2>
        <Suspense fallback={<LoadingCard />}>
          <InboxCardDemo />
        </Suspense>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">AgingBuckets (datos reales)</h2>
        <Suspense fallback={<LoadingCard />}>
          <AgingDemo />
        </Suspense>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">CompanyKpiHero (top customer)</h2>
        <Suspense fallback={<LoadingCard />}>
          <TopCustomerHero />
        </Suspense>
      </section>
    </PageLayout>
  );
}
