import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Inbox,
  XCircle,
} from "lucide-react";

import {
  PageLayout,
  PageHeader,
  SeverityBadge,
  DateDisplay,
  EmptyState,
  StatGrid,
  KpiCard,
  EvidenceChip,
} from "@/components/patterns";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  getInsights,
  getInsightCounts,
  isVisibleToCEO,
  type InsightRow,
  type InsightState,
} from "@/lib/queries/intelligence/insights";
import {
  listInbox,
  type InboxRow,
  type ListInboxOptions,
} from "@/lib/queries/intelligence/inbox";
import { extractEvidenceRefs } from "@/lib/queries/intelligence/evidence-helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Insights" };

type FilterState = "active" | "new" | "seen" | "acted_on" | "dismissed";

const FILTER_STATES: Record<FilterState, InsightState[]> = {
  active: ["new", "seen"],
  new: ["new"],
  seen: ["seen"],
  acted_on: ["acted_on"],
  dismissed: ["dismissed"],
};

const FILTER_LABELS: Record<FilterState, string> = {
  active: "Pendientes",
  new: "Nuevos",
  seen: "Vistos",
  acted_on: "Accionados",
  dismissed: "Descartados",
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; severity?: string }>;
}) {
  const params = await searchParams;
  const state = (params.state as FilterState) ?? "active";
  const stateFilter = FILTER_STATES[state] ?? FILTER_STATES.active;
  const severity = params.severity;

  return (
    <PageLayout>
      <PageHeader
        title="Inbox"
        subtitle="Alertas accionables priorizadas por los directores IA"
      />

      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <InboxKpis />
      </Suspense>

      <FilterTabs active={state} severity={severity} />

      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        }
        key={`${state}-${severity ?? "all"}`}
      >
        <InsightsList stateFilter={stateFilter} severity={severity} />
      </Suspense>

      {/* Reconciliation issues from gold_ceo_inbox (SP5 silver layer) */}
      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        }
      >
        <ReconciliationIssuesList severity={severity} />
      </Suspense>
    </PageLayout>
  );
}

async function InboxKpis() {
  const c = await getInsightCounts();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Nuevos"
        value={c.new}
        format="number"
        icon={Inbox}
        tone={c.new > 0 ? "info" : "default"}
      />
      <KpiCard
        title="Críticos"
        value={c.critical}
        format="number"
        icon={AlertTriangle}
        tone={c.critical > 0 ? "danger" : "default"}
      />
      <KpiCard
        title="Accionados"
        value={c.acted_on}
        format="number"
        icon={CheckCircle2}
        tone="success"
      />
      <KpiCard
        title="Descartados"
        value={c.dismissed}
        format="number"
        icon={XCircle}
      />
    </StatGrid>
  );
}

function FilterTabs({
  active,
  severity,
}: {
  active: FilterState;
  severity?: string;
}) {
  const states: FilterState[] = [
    "active",
    "new",
    "seen",
    "acted_on",
    "dismissed",
  ];
  const severities: Array<{ key: string; label: string }> = [
    { key: "critical", label: "Crítico" },
    { key: "high", label: "Alto" },
    { key: "medium", label: "Medio" },
    { key: "low", label: "Bajo" },
  ];

  return (
    <div className="space-y-2">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
        {states.map((s) => {
          const query = new URLSearchParams();
          query.set("state", s);
          if (severity) query.set("severity", severity);
          return (
            <Link
              key={s}
              href={`/inbox?${query.toString()}`}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {FILTER_LABELS[s]}
            </Link>
          );
        })}
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
        <Link
          href={`/inbox?state=${active}`}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
            !severity
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          Todas severidades
        </Link>
        {severities.map((sev) => (
          <Link
            key={sev.key}
            href={`/inbox?state=${active}&severity=${sev.key}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
              severity === sev.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {sev.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

async function InsightsList({
  stateFilter,
  severity,
}: {
  stateFilter: InsightState[];
  severity?: string;
}) {
  const rawInsights = await getInsights({
    state: stateFilter,
    severity,
    limit: 150, // pre-filter buffer for isVisibleToCEO
  });
  // Audit 2026-04-15 sprint 2: hide low-impact cobranza from CEO inbox.
  // Sandra still sees all of them in her own view (via assignee_email).
  const insights = rawInsights.filter(isVisibleToCEO).slice(0, 100);

  if (insights.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Sin insights"
        description="No hay insights con estos filtros."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {insights.map((i) => (
        <InsightListItem key={i.id} insight={i} />
      ))}
    </div>
  );
}

function InsightListItem({ insight: i }: { insight: InsightRow }) {
  const searchText = [i.title, i.description].filter(Boolean).join(" ");
  const refs = extractEvidenceRefs(searchText).slice(0, 4);
  return (
    <Link href={`/inbox/insight/${i.id}`} className="block">
      <Card className="gap-1 py-3 transition-colors active:bg-accent/50">
        <div className="flex items-start justify-between gap-2 px-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <SeverityBadge
                level={i.severity ?? "medium"}
                pulse={i.state === "new"}
              />
              {i.category && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {i.category}
                </span>
              )}
              {i.state === "new" && (
                <Badge
                  variant="info"
                  className="h-4 px-1 text-[9px] uppercase"
                >
                  Nuevo
                </Badge>
              )}
            </div>
            <div className="truncate text-sm font-semibold">
              {i.title ?? "—"}
            </div>
            {i.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {i.description}
              </p>
            )}
            {refs.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {refs.map((ref, idx) => (
                  <EvidenceChip
                    key={`${ref.reference}-${idx}`}
                    type={ref.type}
                    reference={ref.reference}
                  />
                ))}
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {i.company_name && (
                <span className="truncate max-w-[180px]">
                  {i.company_name}
                </span>
              )}
              {i.agent_name && (
                <>
                  <span>·</span>
                  <span>{i.agent_name}</span>
                </>
              )}
              {i.assignee_name && (
                <>
                  <span>·</span>
                  <span>{i.assignee_name}</span>
                </>
              )}
              {i.created_at && (
                <>
                  <span>·</span>
                  <DateDisplay date={i.created_at} relative />
                </>
              )}
            </div>
          </div>
          <ChevronRight
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </div>
      </Card>
    </Link>
  );
}

// ─── Reconciliation Issues (gold_ceo_inbox / SP5 silver layer) ────────────────

async function ReconciliationIssuesList({ severity }: { severity?: string }) {
  const items = await listInbox({
    limit: 20,
    severity: severity as ListInboxOptions["severity"],
  });

  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Alertas de Reconciliación
      </h2>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <ReconciliationIssueItem key={item.issue_id} item={item} />
        ))}
      </div>
    </section>
  );
}

function ReconciliationIssueItem({ item }: { item: InboxRow }) {
  return (
    <Card className="gap-1 py-3">
      <div className="flex items-start justify-between gap-2 px-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <SeverityBadge level={item.severity ?? "medium"} />
            {item.issue_type && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.issue_type}
              </span>
            )}
          </div>
          <div className="truncate text-sm font-semibold">
            {item.description ?? item.invariant_key ?? "—"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {item.canonical_entity_type && (
              <span className="uppercase">{item.canonical_entity_type}</span>
            )}
            {item.impact_mxn != null && item.impact_mxn > 0 && (
              <>
                <span>·</span>
                <span>
                  {new Intl.NumberFormat("es-MX", {
                    style: "currency",
                    currency: "MXN",
                    maximumFractionDigits: 0,
                  }).format(item.impact_mxn)}
                </span>
              </>
            )}
            {item.age_days != null && (
              <>
                <span>·</span>
                <span>{item.age_days}d</span>
              </>
            )}
            {item.assignee_name && (
              <>
                <span>·</span>
                <span>{item.assignee_name}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

