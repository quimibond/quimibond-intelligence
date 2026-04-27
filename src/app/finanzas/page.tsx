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
  PnlBlock,
  MpQualityBlock,
  CashReconciliationBlock,
  WorkingCapitalBlock,
  ProjectionBlock,
  BankDetailBlock,
  AnomaliesBanner,
  BalanceSheetBlock,
  InvoiceDiscrepanciesBlock,
  ObligationsBlock,
  PnlByAccountBlock,
  FxExposureBlock,
  TaxBlock,
} from "./_components/blocks";

export const revalidate = 60;
export const metadata = { title: "Finanzas" };

type SearchParams = Record<string, string | string[] | undefined>;

type FinanzasTab = "hoy" | "mes" | "detalle";

function parseTab(raw: string | string[] | undefined): FinanzasTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "mes" || v === "detalle") return v;
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
    { id: "pnl", label: "P&L" },
    { id: "balance-sheet", label: "Balance" },
    { id: "ccc", label: "Cash conversion" },
  ],
  detalle: [
    { id: "working-capital", label: "Capital trabajo" },
    { id: "mp-quality", label: "Costos de MP" },
    { id: "pnl-by-account", label: "Gastos por cuenta" },
    { id: "discrepancies", label: "Odoo ↔ SAT" },
    { id: "credit-score", label: "Riesgo cliente" },
    { id: "supplier-priority", label: "Prioridad proveedor" },
    { id: "customer-ltv", label: "LTV" },
    { id: "model-accuracy", label: "Precisión proyección" },
    { id: "fx", label: "FX" },
    { id: "tax", label: "Fiscal" },
    { id: "bank-detail", label: "Detalle bancario" },
  ],
};

const TAB_DEFS: Array<{ id: FinanzasTab; label: string; subtitle: string }> = [
  { id: "hoy", label: "Hoy", subtitle: "Lo accionable de cada día" },
  { id: "mes", label: "Mes en curso", subtitle: "Cómo va el negocio" },
  { id: "detalle", label: "Detalle", subtitle: "Drilldowns analíticos" },
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
            fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}
          >
            <PnlBlock range={period} />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[220px] w-full rounded-lg" />}
          >
            <BalanceSheetBlock />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[240px] w-full rounded-lg" />}
          >
            <CashConversionCycleBlock />
          </Suspense>
        </>
      )}

      {tab === "detalle" && (
        <>
          <Suspense
            fallback={<Skeleton className="h-[260px] w-full rounded-lg" />}
          >
            <WorkingCapitalBlock />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[360px] w-full rounded-lg" />}
          >
            <MpQualityBlock range={period} />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[320px] w-full rounded-lg" />}
          >
            <PnlByAccountBlock range={period} />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[280px] w-full rounded-lg" />}
          >
            <InvoiceDiscrepanciesBlock range={period} />
          </Suspense>

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

          <Suspense
            fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}
          >
            <FxExposureBlock />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[260px] w-full rounded-lg" />}
          >
            <TaxBlock range={period} />
          </Suspense>

          <Suspense fallback={<Skeleton className="h-[160px] w-full rounded-lg" />}>
            <BankDetailBlock />
          </Suspense>
        </>
      )}
    </PageLayout>
  );
}
