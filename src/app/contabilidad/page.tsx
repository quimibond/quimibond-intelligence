import { Suspense } from "react";
import Link from "next/link";

import {
  PageLayout,
  PageHeader,
  SectionNav,
  HistorySelector,
} from "@/components/patterns";
import { parseHistoryRange } from "@/components/patterns/history-range";
import { Skeleton } from "@/components/ui/skeleton";

import { cn } from "@/lib/utils";

import {
  PnlBlock,
  BalanceSheetBlock,
  MpQualityBlock,
  PnlByAccountBlock,
  InvoiceDiscrepanciesBlock,
  TaxBlock,
} from "./_components/blocks";

export const revalidate = 60;
export const metadata = { title: "Contabilidad" };

type SearchParams = Record<string, string | string[] | undefined>;

type ContabilidadTab = "estado" | "detalle" | "fiscal";

function parseTab(raw: string | string[] | undefined): ContabilidadTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "detalle" || v === "fiscal") return v;
  return "estado";
}

const TAB_NAV: Record<
  ContabilidadTab,
  Array<{ id: string; label: string }>
> = {
  estado: [
    { id: "pnl", label: "P&L" },
    { id: "balance-sheet", label: "Balance" },
  ],
  detalle: [
    { id: "mp-quality", label: "Costos de MP" },
    { id: "pnl-by-account", label: "Gastos por cuenta" },
  ],
  fiscal: [
    { id: "discrepancies", label: "Odoo ↔ SAT" },
    { id: "tax", label: "Retenciones + SAT" },
  ],
};

const TAB_DEFS: Array<{ id: ContabilidadTab; label: string; subtitle: string }> = [
  { id: "estado", label: "Estados", subtitle: "P&L y balance" },
  { id: "detalle", label: "Detalle", subtitle: "Drilldowns analíticos" },
  { id: "fiscal", label: "Fiscal", subtitle: "Reconciliación y SAT" },
];

function ContabilidadTabsNav({
  activeTab,
  sp,
}: {
  activeTab: ContabilidadTab;
  sp: SearchParams;
}) {
  const buildHref = (target: ContabilidadTab) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v == null || k === "tab") continue;
      if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
      else params.set(k, v);
    }
    if (target !== "estado") params.set("tab", target);
    const s = params.toString();
    return s ? `/contabilidad?${s}` : "/contabilidad";
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

export default async function ContabilidadPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const period = parseHistoryRange(sp.period, "mtd");
  const tab = parseTab(sp.tab);

  return (
    <PageLayout>
      <PageHeader
        title="Contabilidad"
        subtitle={TAB_DEFS.find((t) => t.id === tab)?.subtitle ?? ""}
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />

      <ContabilidadTabsNav activeTab={tab} sp={sp} />

      <SectionNav items={TAB_NAV[tab]} />

      {tab === "estado" && (
        <>
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
        </>
      )}

      {tab === "detalle" && (
        <>
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
        </>
      )}

      {tab === "fiscal" && (
        <>
          <Suspense
            fallback={<Skeleton className="h-[280px] w-full rounded-lg" />}
          >
            <InvoiceDiscrepanciesBlock range={period} />
          </Suspense>

          <Suspense
            fallback={<Skeleton className="h-[260px] w-full rounded-lg" />}
          >
            <TaxBlock range={period} />
          </Suspense>
        </>
      )}
    </PageLayout>
  );
}
