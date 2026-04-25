import { Suspense } from "react";
import { z } from "zod";
import {
  PageLayout,
  PageHeader,
  HistorySelector,
  LoadingList,
  LoadingCard,
  parseHistoryRange,
  type HistoryRange,
} from "@/components/patterns";
import { parseSearchParams, toSearchString } from "@/lib/url-state";
import { getPurchaseBuyerOptions } from "@/lib/queries/operational/purchases";
import {
  getProcurementKpis,
  getTopSuppliers,
  getUrgentStockouts,
  getCriticalSingleSource,
  getTopPriceAnomalies,
  getPurchaseOrdersList,
  type PurchaseOrderState,
} from "@/lib/queries/sp13/compras";
import { ProcurementHero } from "./_components/ProcurementHero";
import { TopSuppliersSection } from "./_components/TopSuppliersSection";
import { UrgentStockoutsSection } from "./_components/UrgentStockoutsSection";
import { SingleSourceSection } from "./_components/SingleSourceSection";
import { PriceAnomaliesSection } from "./_components/PriceAnomaliesSection";
import { PurchaseOrdersListSection } from "./_components/PurchaseOrdersListSection";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Compras" };

const PO_STATE_VALUES = [
  "all",
  "draft",
  "sent",
  "to approve",
  "purchase",
  "done",
  "cancel",
] as const;

const searchSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  state: z.enum(PO_STATE_VALUES).catch("all"),
  buyer: z.string().trim().max(100).catch("all"),
  sort: z.enum(["-date", "-amount", "name", "state"]).catch("-date"),
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(10).max(100).catch(25),
  range: z.enum(["mtd", "ytd", "ltm", "3y", "5y", "all"]).catch("ytd"),
});

type Search = z.infer<typeof searchSchema>;

const RANGE_LABEL: Record<HistoryRange, string> = {
  mtd: "Mes en curso",
  ytd: "Año en curso",
  ltm: "Últ. 12 meses",
  "3y": "Últ. 3 años",
  "5y": "Últ. 5 años",
  all: "Todo el historial",
};

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = parseSearchParams(raw, searchSchema);
  const range = parseHistoryRange(params.range, "ytd");

  return (
    <PageLayout>
      <PageHeader
        title="Compras"
        subtitle="¿Qué compré, a quién, a qué precio y qué falta por ordenar?"
        actions={<HistorySelector paramName="range" defaultRange="ytd" />}
      />
      <Suspense fallback={<LoadingCard />}>
        <ProcurementHeroAsync range={range} />
      </Suspense>
      <Suspense fallback={<LoadingCard />}>
        <TopSuppliersAsync />
      </Suspense>
      <Suspense fallback={<LoadingCard />}>
        <UrgentStockoutsAsync />
      </Suspense>
      <Suspense fallback={<LoadingCard />}>
        <SingleSourceAsync />
      </Suspense>
      <Suspense fallback={<LoadingCard />}>
        <PriceAnomaliesAsync />
      </Suspense>
      <Suspense fallback={<LoadingList />}>
        <OrdersListAsync params={params} />
      </Suspense>
    </PageLayout>
  );
}

async function ProcurementHeroAsync({ range }: { range: HistoryRange }) {
  const kpis = await getProcurementKpis(range);
  return <ProcurementHero kpis={kpis} rangeLabel={RANGE_LABEL[range]} />;
}

async function TopSuppliersAsync() {
  const rows = await getTopSuppliers(5);
  return <TopSuppliersSection rows={rows} />;
}

async function UrgentStockoutsAsync() {
  const rows = await getUrgentStockouts(5);
  return <UrgentStockoutsSection rows={rows} />;
}

async function SingleSourceAsync() {
  const rows = await getCriticalSingleSource(5);
  return <SingleSourceSection rows={rows} />;
}

async function PriceAnomaliesAsync() {
  const rows = await getTopPriceAnomalies(5);
  return <PriceAnomaliesSection rows={rows} />;
}

async function OrdersListAsync({ params }: { params: Search }) {
  const [result, buyerOptions] = await Promise.all([
    getPurchaseOrdersList({
      search: params.q || undefined,
      state: params.state as PurchaseOrderState,
      buyer: params.buyer === "all" ? undefined : params.buyer,
      sort: params.sort,
      page: params.page,
      limit: params.limit,
    }),
    getPurchaseBuyerOptions(),
  ]);

  const buildPageHref = (page: number) => {
    const qs = toSearchString(
      {
        q: params.q || undefined,
        state: params.state,
        buyer: params.buyer,
        sort: params.sort,
        page,
        limit: params.limit,
        range: params.range,
      },
      {
        dropEqual: {
          state: "all",
          buyer: "all",
          sort: "-date",
          page: 1,
          limit: 25,
          range: "ytd",
        },
      },
    );
    return `/compras${qs}`;
  };

  return (
    <PurchaseOrdersListSection
      result={result}
      params={{
        q: params.q,
        state: params.state as PurchaseOrderState,
        buyer: params.buyer || "all",
        sort: params.sort,
        page: params.page,
        limit: params.limit,
        range: params.range,
      }}
      buyerOptions={buyerOptions}
      buildPageHref={buildPageHref}
    />
  );
}
