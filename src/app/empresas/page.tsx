import { Suspense } from "react";
import { z } from "zod";
import {
  PageLayout,
  PageHeader,
  HistorySelector,
  LoadingList,
  LoadingCard,
} from "@/components/patterns";
import { parseSearchParams, toSearchString } from "@/lib/url-state";
import {
  getPortfolioKpis,
  getTopLtvCustomers,
  getDriftingCompanies,
  getCompaniesPage,
} from "@/lib/queries/sp13/empresas";
import { PortfolioHero } from "./_components/PortfolioHero";
import { TopLtvSection } from "./_components/TopLtvSection";
import { DriftingSection } from "./_components/DriftingSection";
import { CompaniesListSection } from "./_components/CompaniesListSection";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Empresas" };

const searchSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  type: z.enum(["all", "cliente", "proveedor", "ambos", "inactivo"]).catch("all"),
  tier: z.enum(["all", "A", "B", "C"]).catch("all"),
  activity: z.enum(["all", "activa", "dormida", "nueva_90d"]).catch("all"),
  sort: z
    .enum(["-ltv", "-revenue_ytd", "-overdue", "-drift", "-last_invoice", "display_name"])
    .catch("-ltv"),
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(10).max(100).catch(25),
  range: z.enum(["mtd", "ytd", "ltm", "3y", "5y", "all"]).catch("ytd"),
});

type Search = z.infer<typeof searchSchema>;

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = parseSearchParams(raw, searchSchema);

  return (
    <PageLayout>
      <PageHeader
        title="Empresas"
        subtitle="¿Quiénes son, quién importa, quién tiene problemas?"
        actions={<HistorySelector paramName="range" defaultRange="ytd" />}
      />
      <Suspense fallback={<LoadingCard />}>
        <PortfolioHeroAsync />
      </Suspense>
      <Suspense fallback={<LoadingCard />}>
        <TopLtvAsync />
      </Suspense>
      <Suspense fallback={<LoadingCard />}>
        <DriftingAsync />
      </Suspense>
      <Suspense fallback={<LoadingList />}>
        <CompaniesListAsync params={params} />
      </Suspense>
    </PageLayout>
  );
}

async function PortfolioHeroAsync() {
  const kpis = await getPortfolioKpis();
  return <PortfolioHero kpis={kpis} />;
}

async function TopLtvAsync() {
  const rows = await getTopLtvCustomers(5);
  return <TopLtvSection rows={rows} />;
}

async function DriftingAsync() {
  const rows = await getDriftingCompanies(5);
  return <DriftingSection rows={rows} />;
}

async function CompaniesListAsync({ params }: { params: Search }) {
  const result = await getCompaniesPage({
    search: params.q || undefined,
    type: params.type === "all" ? undefined : params.type,
    tier: params.tier === "all" ? undefined : params.tier,
    activity: params.activity === "all" ? undefined : params.activity,
    sort: params.sort,
    page: params.page,
    limit: params.limit,
  });

  const buildPageHref = (page: number) => {
    const qs = toSearchString(
      {
        q: params.q || undefined,
        type: params.type,
        tier: params.tier,
        activity: params.activity,
        sort: params.sort,
        page,
        limit: params.limit,
        range: params.range,
      },
      {
        dropEqual: {
          type: "all",
          tier: "all",
          activity: "all",
          sort: "-ltv",
          page: 1,
          limit: 25,
          range: "ytd",
        },
      },
    );
    return `/empresas${qs}`;
  };

  return (
    <CompaniesListSection
      result={result}
      params={{
        q: params.q,
        type: params.type,
        tier: params.tier,
        activity: params.activity,
        sort: params.sort,
        page: params.page,
        limit: params.limit,
        range: params.range,
      }}
      buildPageHref={buildPageHref}
    />
  );
}
