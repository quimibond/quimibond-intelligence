import { Suspense } from "react";
import { z } from "zod";

import {
  DriftAlert,
  HistorySelector,
  PageHeader,
  PageLayout,
  QuestionSection,
  SectionNav,
  StatGrid,
} from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshStalenessBadge } from "@/components/patterns/refresh-staleness-badge";

import { getUnifiedRefreshStaleness } from "@/lib/queries/unified";
import { getAgingBuckets, getDsoTrend } from "@/lib/queries/sp13/cobranza";
import { parseSearchParams } from "@/lib/url-state";

import { ArHeroKpis } from "./_components/ArHeroKpis";
import { ArAgingRow } from "./_components/ArAgingRow";
import { ArByCompanyTable } from "./_components/ArByCompanyTable";
import { ActionListSection } from "./_components/ActionListSection";
import { DsoTrendChart } from "./_components/DsoTrendChart";
import { OpenInvoicesTable } from "./_components/OpenInvoicesTable";

export const revalidate = 60;
export const metadata = { title: "Cobranza" };

const searchSchema = z.object({
  // HistorySelector param (currently cosmetic — AR is always snapshot).
  period: z.enum(["mtd", "ytd", "ltm", "3y", "5y", "all"]).catch("mtd"),
  // Shared bucket filter between AgingBuckets + Companies table + Open invoices.
  bucket: z.enum(["1-30", "31-60", "61-90", "90+"]).optional().catch(undefined),
  risk: z.enum(["critical"]).optional().catch(undefined),
  q: z.string().trim().max(100).catch(""),
  invQ: z.string().trim().max(100).catch(""),
  invBucket: z.enum(["1-30", "31-60", "61-90", "90+"]).optional().catch(undefined),
  estadoSat: z.enum(["vigente", "cancelado"]).optional().catch(undefined),
  caPage: z.coerce.number().int().min(1).catch(1),
  invPage: z.coerce.number().int().min(1).catch(1),
  size: z.coerce.number().int().min(10).max(200).catch(25),
});

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CobranzaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const params = parseSearchParams(sp, searchSchema);
  const staleness = await getUnifiedRefreshStaleness();

  return (
    <PageLayout>
      <PageHeader
        title="Cobranza"
        subtitle="¿Quién me debe, quién no paga, a quién cobrar hoy?"
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />

      <RefreshStalenessBadge
        minutesSinceRefresh={staleness.minutesSinceRefresh}
        invoicesRefreshedAt={staleness.invoicesRefreshedAt}
      />

      <DriftAlert
        severity="info"
        title="Algunos estados de pago pueden estar desfasados"
        description="SP10 payment merge pendiente (F2/F3). Facturas pagadas solo en SAT o solo en Odoo pueden mostrarse como abiertas aquí hasta que el merge termine."
      />

      <SectionNav
        items={[
          { id: "ar", label: "Cartera" },
          { id: "companies", label: "Empresas con deuda" },
          { id: "action", label: "Cobrar hoy" },
          { id: "dso", label: "DSO" },
          { id: "invoices", label: "Facturas" },
        ]}
      />

      {/* C1+C2 — Hero */}
      <section id="ar" className="scroll-mt-24 space-y-4">
        <Suspense fallback={<KpiFallback />}>
          <ArHeroKpis />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-24 rounded-md" />}>
          <AgingRowAsync bucket={params.bucket} />
        </Suspense>
      </section>

      {/* C3+C5 — Empresas con deuda (+ riesgo) */}
      <QuestionSection
        id="companies"
        question="¿Quién me debe más y quién está en riesgo?"
        subtext="Ordenado por AR vencido. Filtra por aging o riesgo IA para acotar la lista."
      >
        <Suspense fallback={<RowsFallback rows={6} />}>
          <ArByCompanyTable
            page={params.caPage}
            size={params.size}
            bucket={params.bucket}
            risk={params.risk === "critical" ? "critical" : undefined}
            q={params.q || undefined}
          />
        </Suspense>
      </QuestionSection>

      {/* C6 — Action list */}
      <QuestionSection
        id="action"
        question="¿Qué cobrar HOY con prioridad?"
        subtext="Top 20 priorizados por (monto × probabilidad de no pago × factor de días vencidos)."
      >
        <Suspense fallback={<RowsFallback rows={6} />}>
          <ActionListSection top={20} />
        </Suspense>
      </QuestionSection>

      {/* C8 — DSO trend */}
      <QuestionSection
        id="dso"
        question="¿Cómo va el DSO?"
        subtext="Proxy mensual: promedio ponderado de días de cobro sobre las asignaciones de pago del mes."
      >
        <Suspense fallback={<Skeleton className="h-[260px] rounded-md" />}>
          <DsoTrendAsync />
        </Suspense>
      </QuestionSection>

      {/* C7 — Open invoices table */}
      <QuestionSection
        id="invoices"
        question="¿Qué facturas individuales están abiertas?"
        subtext="Todas las facturas emitidas no pagadas. Ordena por residual descendiendo por default."
      >
        <Suspense fallback={<RowsFallback rows={8} />}>
          <OpenInvoicesTable
            page={params.invPage}
            size={params.size}
            q={params.invQ || undefined}
            bucket={params.invBucket}
            estadoSat={params.estadoSat}
          />
        </Suspense>
      </QuestionSection>
    </PageLayout>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Async wrappers
// ──────────────────────────────────────────────────────────────────────────
async function AgingRowAsync({ bucket }: { bucket?: string }) {
  const r = await getAgingBuckets();
  return (
    <ArAgingRow
      data={{
        current: r.totals.current,
        d1_30: r.totals.d1_30,
        d31_60: r.totals.d31_60,
        d61_90: r.totals.d61_90,
        d90_plus: r.totals.d90_plus,
      }}
      currentBucket={bucket}
    />
  );
}

async function DsoTrendAsync() {
  const data = await getDsoTrend(12);
  return <DsoTrendChart data={data} targetDays={45} />;
}

// ──────────────────────────────────────────────────────────────────────────
// Loading fallbacks
// ──────────────────────────────────────────────────────────────────────────
function KpiFallback() {
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[96px] rounded-xl" />
      ))}
    </StatGrid>
  );
}

function RowsFallback({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 rounded-lg" />
      ))}
    </div>
  );
}
