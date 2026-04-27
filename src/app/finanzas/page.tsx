import { Suspense } from "react";
import Link from "next/link";

import {
  PageLayout,
  PageHeader,
  SectionNav,
  StatGrid,
  HistorySelector,
} from "@/components/patterns";
import { parseHistoryRange } from "@/components/patterns/history-range";
import { Skeleton } from "@/components/ui/skeleton";

import { parseProjectionHorizon } from "@/lib/queries/sp13/finanzas";
import { cn } from "@/lib/utils";

import {
  CustomerCreditScoresBlock,
  SupplierPriorityBlock,
  CustomerLtvBlock,
  ProjectionAccuracyBlock,
  CashConversionCycleBlock,
  DriftBanner,
  HeroKpis,
  CashReconciliationBlock,
  WorkingCapitalBlock,
  ProjectionBlock,
  BankDetailBlock,
  AnomaliesBanner,
  ObligationsBlock,
  FxExposureBlock,
} from "./_components/blocks";

export const revalidate = 60;
export const metadata = { title: "Finanzas" };

type SearchParams = Record<string, string | string[] | undefined>;

type FinanzasTab = "hoy" | "mes" | "decisiones" | "detalle";

function parseTab(raw: string | string[] | undefined): FinanzasTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "mes" || v === "decisiones" || v === "detalle") return v;
  return "hoy";
}

const TAB_NAV: Record<
  FinanzasTab,
  Array<{ id: string; label: string }>
> = {
  hoy: [
    { id: "hero", label: "Snapshot" },
    { id: "projection", label: "Proyección" },
    { id: "obligations", label: "Obligaciones" },
  ],
  mes: [
    { id: "cash-reconciliation", label: "¿Dónde está el dinero?" },
    { id: "ccc", label: "Cash conversion" },
    { id: "working-capital", label: "Capital trabajo" },
  ],
  decisiones: [
    { id: "credit-score", label: "Riesgo cliente" },
    { id: "supplier-priority", label: "Prioridad proveedor" },
    { id: "customer-ltv", label: "LTV" },
    { id: "model-accuracy", label: "Precisión proyección" },
  ],
  detalle: [
    { id: "fx", label: "FX" },
    { id: "bank-detail", label: "Detalle bancario" },
  ],
};

const TAB_DEFS: Array<{ id: FinanzasTab; label: string; subtitle: string }> = [
  { id: "hoy", label: "Hoy", subtitle: "Lo accionable de cada día" },
  { id: "mes", label: "Mes en curso", subtitle: "Cómo va el cash" },
  { id: "decisiones", label: "Decisiones", subtitle: "Scoring para acción" },
  { id: "detalle", label: "Detalle", subtitle: "Drilldowns" },
];

function FinanzasTabsNav({
  activeTab,
  sp,
}: {
  activeTab: FinanzasTab;
  sp: SearchParams;
}) {
  const buildHref = (target: FinanzasTab) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v == null || k === "tab") continue;
      if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
      else params.set(k, v);
    }
    if (target !== "hoy") params.set("tab", target);
    const s = params.toString();
    return s ? `/finanzas?${s}` : "/finanzas";
  };
  return (
    <div className="-mx-2 flex gap-1 overflow-x-auto px-2 sm:mx-0 sm:px-0">
      {TAB_DEFS.map((t) => {
        const active = t.id === activeTab;
        return (
          <Link
            key={t.id}
            href={buildHref(t.id)}
            scroll={false}
            className={cn(
              "shrink-0 rounded-md border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-foreground/20 bg-foreground text-background font-medium"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
            )}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

export default async function FinanzasPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const period = parseHistoryRange(sp.period, "mtd");
  const horizon = parseProjectionHorizon(sp.proj_horizon, 13);
  const tab = parseTab(sp.tab);

  return (
    <PageLayout>
      <PageHeader
        title="Finanzas"
        subtitle={TAB_DEFS.find((t) => t.id === tab)?.subtitle ?? ""}
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />

      <FinanzasTabsNav activeTab={tab} sp={sp} />

      <Suspense fallback={null}>
        <AnomaliesBanner />
      </Suspense>

      <Suspense fallback={null}>
        <DriftBanner range={period} />
      </Suspense>

      <SectionNav items={TAB_NAV[tab]} />

      {tab === "hoy" && (
        <>
          <section id="hero" className="scroll-mt-24">
            <Suspense
              fallback={
                <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-[112px] rounded-xl" />
                  ))}
                </StatGrid>
              }
            >
              <HeroKpis />
            </Suspense>
          </section>

          <Suspense
            fallback={<Skeleton className="h-[380px] w-full rounded-lg" />}
          >
            <ProjectionBlock horizon={horizon} />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[320px] w-full rounded-lg" />}
          >
            <ObligationsBlock />
          </Suspense>
        </>
      )}

      {tab === "mes" && (
        <>
          <Suspense
            fallback={<Skeleton className="h-[380px] w-full rounded-lg" />}
          >
            <CashReconciliationBlock range={period} />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[240px] w-full rounded-lg" />}
          >
            <CashConversionCycleBlock />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[260px] w-full rounded-lg" />}
          >
            <WorkingCapitalBlock />
          </Suspense>
        </>
      )}

      {tab === "decisiones" && (
        <>
          <Suspense
            fallback={<Skeleton className="h-[280px] w-full rounded-lg" />}
          >
            <CustomerCreditScoresBlock />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[280px] w-full rounded-lg" />}
          >
            <SupplierPriorityBlock />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[280px] w-full rounded-lg" />}
          >
            <CustomerLtvBlock />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}
          >
            <ProjectionAccuracyBlock />
          </Suspense>
        </>
      )}

      {tab === "detalle" && (
        <>
          <Suspense
            fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}
          >
            <FxExposureBlock />
          </Suspense>

          <Suspense fallback={<Skeleton className="h-[160px] w-full rounded-lg" />}>
            <BankDetailBlock />
          </Suspense>
        </>
      )}
    </PageLayout>
  );
}
