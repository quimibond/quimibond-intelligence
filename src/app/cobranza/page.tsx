import { Suspense } from "react";
import { z } from "zod";

import {
  PageLayout,
  PageHeader,
  SectionNav,
  StatGrid,
} from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { RefreshStalenessBadge } from "@/components/patterns/refresh-staleness-badge";

import {
  getCompanyAgingPage,
  getPaymentPredictionsPage,
  invoicesReceivableAging,
} from "@/lib/queries/unified/invoices";
import { getUnifiedRefreshStaleness } from "@/lib/queries/unified";
import { parseSearchParams } from "@/lib/url-state";

import { CobranzaHeroKpis } from "./_components/CobranzaHeroKpis";
import { CeiSection } from "./_components/CeiSection";
import { AgingSection } from "./_components/AgingSection";
import { adaptAging } from "./_components/aging-adapter";
import { PaymentRiskSection } from "./_components/PaymentRiskSection";
import { CompanyAgingSection } from "./_components/CompanyAgingSection";
import { OverdueSection } from "./_components/OverdueSection";

export const revalidate = 60;
export const metadata = { title: "Cobranza" };

const searchSchema = z.object({
  aging: z.enum(["1-30", "31-60", "61-90", "90+"]).optional().catch(undefined),
  q: z.string().trim().max(100).catch(""),
  salesperson: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  prPage: z.coerce.number().int().min(1).catch(1),
  caPage: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(10).max(200).catch(50),
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
        subtitle="¿Quién me debe, cuánto, y quién va a pagar mal?"
        actions={
          <DataSourceBadge
            source="unified"
            coverage="Odoo operativo + SAT validado"
            refresh="15min"
          />
        }
      />

      <RefreshStalenessBadge
        minutesSinceRefresh={staleness.minutesSinceRefresh}
        invoicesRefreshedAt={staleness.invoicesRefreshedAt}
      />

      <SectionNav
        items={[
          { id: "kpis", label: "Resumen" },
          { id: "cei", label: "CEI" },
          { id: "buckets", label: "Aging buckets" },
          { id: "payment-risk", label: "Riesgo de pago" },
          { id: "company-aging", label: "Cartera por cliente" },
          { id: "overdue", label: "Facturas vencidas" },
        ]}
      />

      <section id="kpis" className="scroll-mt-24 space-y-4">
        <Suspense fallback={<KpiFallback />}>
          <CobranzaHeroKpis />
        </Suspense>
      </section>

      <section id="cei" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Collection Effectiveness Index (CEI)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              % del facturado cobrado por cohort mensual.
            </p>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<RowsFallback rows={6} />}>
              <CeiSection />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      <section id="buckets" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aging buckets</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<Skeleton className="h-24 rounded-md" />}>
              <AgingSectionAsync currentAging={params.aging} />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      <section id="payment-risk" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Clientes con patrón anormal de pago
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<RowsFallback rows={4} />}>
              <PaymentRiskSectionAsync page={params.prPage} limit={params.limit} />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      <section id="company-aging" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cartera por cliente</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<RowsFallback rows={5} />}>
              <CompanyAgingSectionAsync page={params.caPage} limit={params.limit} />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      <section id="overdue" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Facturas vencidas</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<RowsFallback rows={6} />}>
              <OverdueSection
                params={{
                  aging: params.aging,
                  q: params.q,
                  salesperson: params.salesperson,
                  page: params.page,
                  limit: params.limit,
                }}
              />
            </Suspense>
          </CardContent>
        </Card>
      </section>
    </PageLayout>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Async wrappers — colocated here because they are tiny one-shot fetchers
// ──────────────────────────────────────────────────────────────────────────
async function AgingSectionAsync({ currentAging }: { currentAging?: string }) {
  const raw = await invoicesReceivableAging();
  return <AgingSection data={adaptAging(raw)} currentAging={currentAging} />;
}

async function PaymentRiskSectionAsync({
  page,
  limit,
}: {
  page: number;
  limit: number;
}) {
  const data = await getPaymentPredictionsPage({ page, size: limit });
  return <PaymentRiskSection rows={data.rows} />;
}

async function CompanyAgingSectionAsync({
  page,
  limit,
}: {
  page: number;
  limit: number;
}) {
  const data = await getCompanyAgingPage({ page, size: limit });
  return <CompanyAgingSection rows={data.rows} />;
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
