import { Suspense } from "react";

import {
  PageLayout,
  PageHeader,
  HistorySelector,
  PrintButton,
} from "@/components/patterns";
import { parseHistoryRange } from "@/components/patterns/history-range";
import { Skeleton } from "@/components/ui/skeleton";
import { OdooPendingBanner } from "@/components/odoo-pending-banner";

import { getCostCentersSnapshot } from "@/lib/queries/sp13/finanzas/cost-centers";
import { getDefectCost } from "@/lib/queries/sp13/finanzas/defect-cost";
import { getRamaBurden } from "@/lib/queries/sp13/finanzas/rama-burden";
import { getWorkcenterStandard } from "@/lib/queries/sp13/finanzas/workcenter-standard";
import { CostCentersTable } from "./_components/cost-centers-table";
import { CostCentersIntro } from "./_components/cost-centers-intro";
import { DefectCostCard } from "./_components/defect-cost-card";
import { RamaBurdenCard } from "./_components/rama-burden-card";
import { WorkcenterStandardCard } from "./_components/workcenter-standard-card";

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
        actions={
          <div className="flex items-center gap-2">
            <HistorySelector paramName="period" defaultRange="mtd" />
            <PrintButton />
          </div>
        }
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

      <Suspense fallback={null}>
        <OdooPendingBanner actionKey="workorder-tiempos-no-confiables" />
      </Suspense>

      <Suspense fallback={null}>
        <OdooPendingBanner actionKey="saldo-desperdicio-costo-cero" />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}>
        <CostCentersBlock range={range} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}>
        <WorkcenterStandardBlock />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}>
        <RamaBurdenBlock />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}>
        <DefectCostBlock />
      </Suspense>
    </PageLayout>
  );
}

async function WorkcenterStandardBlock() {
  const summary = await getWorkcenterStandard("TEJIDO", 18);
  return <WorkcenterStandardCard summary={summary} />;
}

async function CostCentersBlock({
  range,
}: {
  range: ReturnType<typeof parseHistoryRange>;
}) {
  const snapshot = await getCostCentersSnapshot(range);
  return <CostCentersTable snapshot={snapshot} />;
}

async function RamaBurdenBlock() {
  const summary = await getRamaBurden(12);
  return <RamaBurdenCard summary={summary} />;
}

async function DefectCostBlock() {
  const summary = await getDefectCost(18);
  return <DefectCostCard summary={summary} />;
}
