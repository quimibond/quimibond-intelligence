import { Suspense } from "react";

import {
  PageLayout,
  PageHeader,
  HistorySelector,
} from "@/components/patterns";
import { parseHistoryRange } from "@/components/patterns/history-range";
import { Skeleton } from "@/components/ui/skeleton";
import { OdooPendingBanner } from "@/components/odoo-pending-banner";

import { getCostCentersSnapshot } from "@/lib/queries/sp13/finanzas/cost-centers";
import { CostCentersTable } from "./_components/cost-centers-table";
import { CostCentersIntro } from "./_components/cost-centers-intro";

export const dynamic = "force-dynamic";
export const metadata = { title: "Centros de costo — Quimibond" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CentrosDeCostoPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const range = parseHistoryRange(sp.period, "mtd");

  return (
    <PageLayout>
      <PageHeader
        title="Centros de costo"
        subtitle="MOD + overhead por departamento productivo"
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />

      <CostCentersIntro />

      <Suspense fallback={null}>
        <OdooPendingBanner actionKey="configure-workcenters-acabado-tintoreria-entretelas" />
      </Suspense>

      <Suspense fallback={null}>
        <OdooPendingBanner actionKey="pnl-limpio-rewrite-avco-regimen" />
      </Suspense>

      <Suspense fallback={null}>
        <OdooPendingBanner actionKey="investigate-renta-abril-baja" />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}>
        <CostCentersBlock range={range} />
      </Suspense>
    </PageLayout>
  );
}

async function CostCentersBlock({
  range,
}: {
  range: ReturnType<typeof parseHistoryRange>;
}) {
  const snapshot = await getCostCentersSnapshot(range);
  return <CostCentersTable snapshot={snapshot} />;
}
