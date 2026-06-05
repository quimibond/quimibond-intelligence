import { Suspense } from "react";

import {
  PageLayout,
  PageHeader,
  HistorySelector,
} from "@/components/patterns";
import { parseHistoryRange } from "@/components/patterns/history-range";
import { Skeleton } from "@/components/ui/skeleton";

import { getCostReconSnapshot } from "@/lib/queries/sp13/finanzas/cost-reconstruction";
import { OdooPendingBanner } from "@/components/odoo-pending-banner";
import { CostReconView } from "./_components/cost-recon-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costo reconstruido — Quimibond" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CostoReconstruidoPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const range = parseHistoryRange(sp.period, "mtd");

  return (
    <PageLayout>
      <PageHeader
        title="Costo reconstruido por producto"
        subtitle="Absorption costing por fuera: MP (último costo de compra) + gastos por metro"
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />

      <OdooPendingBanner actionKey="bom-cantidades-infladas-wc090-wj055" inline />

      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-lg" />}>
        <CostReconBlock range={range} />
      </Suspense>
    </PageLayout>
  );
}

async function CostReconBlock({
  range,
}: {
  range: ReturnType<typeof parseHistoryRange>;
}) {
  const snapshot = await getCostReconSnapshot(range);
  return <CostReconView snapshot={snapshot} />;
}
