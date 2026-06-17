import { Suspense } from "react";

import { PageLayout, PageHeader, HistorySelector } from "@/components/patterns";
import { parseHistoryRange } from "@/components/patterns/history-range";
import type { HistoryRange } from "@/components/patterns/history-range";
import { Skeleton } from "@/components/ui/skeleton";

import { getContributionSnapshot } from "@/lib/queries/sp13/finanzas/contribution-margin";
import { ContributionView } from "./_components/contribution-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Margen de contribución — Quimibond" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function MargenContribucionPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const range = parseHistoryRange(sp.period, "mtd");

  return (
    <PageLayout>
      <PageHeader
        title="Margen de contribución"
        subtitle="Precio − costo variable (MP + energía). Los fijos son costo del período → punto de equilibrio"
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />
      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-lg" />}>
        <Block range={range} />
      </Suspense>
    </PageLayout>
  );
}

async function Block({ range }: { range: HistoryRange }) {
  const data = await getContributionSnapshot(range);
  return <ContributionView data={data} />;
}
