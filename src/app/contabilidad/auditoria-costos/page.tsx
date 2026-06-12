import { Suspense } from "react";

import { PageLayout, PageHeader, HistorySelector } from "@/components/patterns";
import { parseHistoryRange } from "@/components/patterns/history-range";
import { Skeleton } from "@/components/ui/skeleton";

import { getCostAuditSnapshot } from "@/lib/queries/sp13/finanzas/cost-audit";
import { CostAuditView } from "./_components/cost-audit-view";
import type { HistoryRange } from "@/components/patterns/history-range";

export const dynamic = "force-dynamic";
export const metadata = { title: "Auditoría de costos — Quimibond" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AuditoriaCostosPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const range = parseHistoryRange(sp.period, "mtd");

  return (
    <PageLayout>
      <PageHeader
        title="Auditoría de costos"
        subtitle="Reconciliación GL ↔ absorbido por departamento y por familia (sin duplicados)"
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />
      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-lg" />}>
        <AuditBlock range={range} />
      </Suspense>
    </PageLayout>
  );
}

async function AuditBlock({ range }: { range: HistoryRange }) {
  const data = await getCostAuditSnapshot(range);
  return <CostAuditView data={data} />;
}
