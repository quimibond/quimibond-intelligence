import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CalendarClock,
  CreditCard,
  FileX,
  Flame,
  Inbox,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import {
  PageLayout,
  PageHeader,
  SectionNav,
  StatGrid,
  KpiCard,
  QuestionSection,
  HistorySelector,
  parseHistoryRange,
  DriftAlert,
  Currency,
  EmptyState,
} from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getCashKpis,
  getRunwayKpis,
  getPnlKpis,
  getPnlWaterfall,
  getWorkingCapital,
  getCashProjection,
  getBankDetail,
  getDriftSummary,
  parseProjectionHorizon,
} from "@/lib/queries/sp13/finanzas";
import { formatCurrencyMXN } from "@/lib/formatters";
import type { HistoryRange } from "@/components/patterns/history-selector";

import { PnlWaterfallChart } from "./_components/pnl-waterfall-chart";
import { CashProjectionChart } from "./_components/cash-projection-chart";
import { ProjectionHorizonSelector } from "./_components/projection-horizon-selector";
import { BankDetailExpand } from "./_components/bank-detail-expand";

export const revalidate = 60;
export const metadata = { title: "Finanzas" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function FinanzasPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const period = parseHistoryRange(sp.period, "mtd");
  const plPeriod = parseHistoryRange(sp.pl_period, "mtd");
  const horizon = parseProjectionHorizon(sp.proj_horizon, 13);

  return (
    <PageLayout>
      <PageHeader
        title="Finanzas"
        subtitle="¿Cuánto tengo, cuánto me alcanza, qué viene?"
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />

      <Suspense fallback={null}>
        <DriftBanner range={period} />
      </Suspense>

      <SectionNav
        items={[
          { id: "hero", label: "Snapshot" },
          { id: "pnl", label: "P&L" },
          { id: "working-capital", label: "Capital trabajo" },
          { id: "projection", label: "Proyección" },
          { id: "bank-detail", label: "Detalle bancario" },
        ]}
      />

      {/* F1 + F2 — Hero snapshot */}
      <section id="hero" className="scroll-mt-24">
        <Suspense
          fallback={
            <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[112px] rounded-xl" />
              ))}
            </StatGrid>
          }
        >
          <HeroKpis />
        </Suspense>
      </section>

      {/* F3 — P&L */}
      <Suspense
        fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}
      >
        <PnlBlock range={plPeriod} />
      </Suspense>

      {/* F4 — Working capital */}
      <Suspense
        fallback={<Skeleton className="h-[260px] w-full rounded-lg" />}
      >
        <WorkingCapitalBlock />
      </Suspense>

      {/* F5 — Projection */}
      <Suspense
        fallback={<Skeleton className="h-[380px] w-full rounded-lg" />}
      >
        <ProjectionBlock horizon={horizon} />
      </Suspense>

      {/* F7 — Bank detail expandable */}
      <section id="bank-detail" className="scroll-mt-24">
        <Suspense fallback={<Skeleton className="h-[56px] w-full rounded-lg" />}>
          <BankDetailBlock />
        </Suspense>
      </section>
    </PageLayout>
  );
}

/* ── F7 condicional — DriftAlert ────────────────────────────────────── */
async function DriftBanner({ range }: { range: HistoryRange }) {
  const drift = await getDriftSummary(range);
  if (drift.severity === "info") return null;
  return (
    <DriftAlert
      severity={drift.severity}
      title={drift.title}
      description={drift.description}
      action={{ label: "Ver detalle", href: "/sistema?tab=reconciliacion" }}
    />
  );
}

/* ── F1 + F2 Hero KPIs ───────────────────────────────────────────────── */
async function HeroKpis() {
  const [cash, runway] = await Promise.all([getCashKpis(), getRunwayKpis()]);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Efectivo total"
        value={cash.efectivoTotalMxn}
        format="currency"
        compact
        icon={Wallet}
        source="canonical"
        tone="default"
        subtitle={`${cash.cashAccountsCount} cuentas efectivo`}
        definition={{
          title: "Efectivo total",
          description: "Suma de saldos en cuentas clasificadas como efectivo.",
          formula: "SUM(current_balance_mxn WHERE classification='cash')",
          table: "canonical_bank_balances",
        }}
      />
      <KpiCard
        title="Deuda tarjetas"
        value={cash.deudaTarjetasMxn}
        format="currency"
        compact
        icon={CreditCard}
        source="canonical"
        tone={cash.deudaTarjetasMxn > 0 ? "danger" : "default"}
        subtitle={`${cash.debtAccountsCount} tarjeta${cash.debtAccountsCount === 1 ? "" : "s"}`}
        definition={{
          title: "Deuda tarjetas",
          description: "Saldo negativo acumulado en cuentas classification='debt'.",
          formula: "ABS(SUM(current_balance_mxn WHERE classification='debt'))",
          table: "canonical_bank_balances",
        }}
      />
      <KpiCard
        title="Runway cash-only"
        value={runway.runwayCashOnlyDays ?? 0}
        format="days"
        icon={Flame}
        source="canonical"
        tone={
          runway.runwayCashOnlyDays != null && runway.runwayCashOnlyDays < 30
            ? "danger"
            : runway.runwayCashOnlyDays != null && runway.runwayCashOnlyDays < 60
              ? "warning"
              : "success"
        }
        subtitle={`burn ${formatCurrencyMXN(runway.burnRateMonthly, { compact: true })}/mes`}
        definition={{
          title: "Runway (solo efectivo)",
          description: "Días de operación con el cash actual al ritmo de gasto de los últimos 90 días.",
          formula: "cash / (avg_monthly_expense / 30)",
          table: "canonical_bank_balances + gold_pl_statement",
        }}
      />
      <KpiCard
        title="Runway con AR"
        value={runway.runwayWithArDays ?? 0}
        format="days"
        icon={CalendarClock}
        source="canonical"
        tone="info"
        subtitle={`suponiendo cobranza de ${formatCurrencyMXN(runway.arOpenMxn, { compact: true })}`}
        definition={{
          title: "Runway con AR",
          description: "Días de operación suponiendo cobranza normal del AR abierto.",
          formula: "(cash + ar_open) / burn_daily",
          table: "canonical_bank_balances + canonical_invoices + gold_pl_statement",
        }}
      />
    </StatGrid>
  );
}

/* ── F3 P&L ──────────────────────────────────────────────────────────── */
async function PnlBlock({ range }: { range: HistoryRange }) {
  const [kpis, waterfall] = await Promise.all([
    getPnlKpis(range),
    getPnlWaterfall(range),
  ]);

  const hasData = kpis.monthsCovered > 0;

  return (
    <QuestionSection
      id="pnl"
      question="¿Cómo va mi P&L?"
      subtext={`Ingresos, costos y utilidad · ${kpis.periodLabel}`}
      actions={<HistorySelector paramName="pl_period" defaultRange="mtd" />}
    >
      {!hasData ? (
        <EmptyState
          icon={FileX}
          title="Sin datos de P&L en el período"
          description="Ajusta el rango o revisa la sincronización contable."
        />
      ) : (
        <>
          <StatGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
            <KpiCard
              title="Ingresos"
              value={kpis.ingresosPl}
              format="currency"
              compact
              icon={TrendingUp}
              source="pl"
              sources={[
                {
                  source: "pl",
                  value: kpis.ingresosPl,
                  diffFromPrimary: 0,
                  diffPct: 0,
                },
                {
                  source: "sat",
                  value: kpis.ingresosSat,
                  diffFromPrimary: kpis.ingresosSat - kpis.ingresosPl,
                  diffPct:
                    kpis.ingresosPl > 0
                      ? ((kpis.ingresosSat - kpis.ingresosPl) / kpis.ingresosPl) * 100
                      : 0,
                },
              ]}
              tone="success"
              subtitle={
                kpis.driftPct == null
                  ? undefined
                  : `drift SAT vs P&L: ${kpis.driftPct.toFixed(1)}%`
              }
            />
            <KpiCard
              title="Costos + Gastos"
              value={kpis.costoVentas + kpis.gastosOperativos}
              format="currency"
              compact
              icon={TrendingDown}
              source="pl"
              tone="warning"
              subtitle={`COGS ${formatCurrencyMXN(kpis.costoVentas, { compact: true })} · Op ${formatCurrencyMXN(kpis.gastosOperativos, { compact: true })}`}
            />
            <KpiCard
              title="Utilidad neta"
              value={kpis.utilidadNeta}
              format="currency"
              compact
              icon={Scale}
              source="pl"
              tone={kpis.utilidadNeta >= 0 ? "success" : "danger"}
              subtitle={`${kpis.monthsCovered} mes${kpis.monthsCovered === 1 ? "" : "es"} del período`}
            />
          </StatGrid>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Waterfall: cómo llego de Ingresos a Utilidad neta</CardTitle>
            </CardHeader>
            <CardContent>
              <PnlWaterfallChart data={waterfall} />
            </CardContent>
          </Card>
        </>
      )}
    </QuestionSection>
  );
}

/* ── F4 Working Capital ───────────────────────────────────────────────── */
async function WorkingCapitalBlock() {
  const wc = await getWorkingCapital();

  return (
    <QuestionSection
      id="working-capital"
      question="¿Cuál es mi capital de trabajo?"
      subtext="AR (me deben), AP (yo debo), y los principales contribuidores"
    >
      <StatGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
        <KpiCard
          title="AR — me deben"
          value={wc.arTotalMxn}
          format="currency"
          compact
          icon={ArrowDownCircle}
          source="canonical"
          tone="info"
          href="/cobranza"
          subtitle={`vencido ${formatCurrencyMXN(wc.arOverdueMxn, { compact: true })} · ${wc.arInvoiceCount} facturas`}
        />
        <KpiCard
          title="AP — yo debo"
          value={wc.apTotalMxn}
          format="currency"
          compact
          icon={ArrowUpCircle}
          source="canonical"
          tone="warning"
          href="/compras"
          subtitle={`vencido ${formatCurrencyMXN(wc.apOverdueMxn, { compact: true })} · ${wc.apInvoiceCount} facturas`}
        />
        <KpiCard
          title="Neto (AR − AP)"
          value={wc.netoMxn}
          format="currency"
          compact
          icon={Banknote}
          source="canonical"
          tone={wc.netoMxn >= 0 ? "success" : "danger"}
          subtitle={
            wc.dsoDays != null && wc.dpoDays != null
              ? `DSO ${wc.dsoDays}d · DPO ${wc.dpoDays}d`
              : "rotación en cálculo"
          }
        />
      </StatGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <ContributorsTable
          title="Top 10 me deben"
          rows={wc.topAr}
          hrefBase="/cobranza"
        />
        <ContributorsTable
          title="Top 10 yo debo"
          rows={wc.topAp}
          hrefBase="/compras"
        />
      </div>
    </QuestionSection>
  );
}

function ContributorsTable({
  title,
  rows,
  hrefBase,
}: {
  title: string;
  rows: Array<{
    companyId: number | null;
    companyName: string | null;
    totalMxn: number;
    overdueMxn: number;
    invoiceCount: number;
  }>;
  hrefBase: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Link
          href={hrefBase}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Ver todo →
        </Link>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              compact
              icon={Inbox}
              title="Sin contribuidores"
              description="No hay saldos abiertos en este lado."
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Empresa</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Vencido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr
                  key={r.companyId ?? r.companyName ?? i}
                  className="hover:bg-accent/20"
                >
                  <td className="px-4 py-2">
                    {r.companyId ? (
                      <Link
                        href={`/empresas/${r.companyId}`}
                        className="font-medium hover:underline"
                      >
                        {r.companyName}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.companyName}</span>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {r.invoiceCount} factura{r.invoiceCount === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <Currency amount={r.totalMxn} />
                  </td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      r.overdueMxn > 0 ? "text-danger" : "text-muted-foreground"
                    }`}
                  >
                    {r.overdueMxn > 0 ? (
                      <Currency amount={r.overdueMxn} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ── F5 Projection ───────────────────────────────────────────────────── */
async function ProjectionBlock({ horizon }: { horizon: 13 | 30 | 90 }) {
  const proj = await getCashProjection(horizon);
  const belowFloor = proj.minBalance < proj.safetyFloor;

  return (
    <QuestionSection
      id="projection"
      question="¿Qué va a pasar con el efectivo?"
      subtext="Saldo proyectado basado en due dates del AR/AP abierto"
      actions={<ProjectionHorizonSelector paramName="proj_horizon" value={horizon} />}
    >
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <SummaryStat
              label="Saldo inicial"
              value={proj.openingBalance}
            />
            <SummaryStat
              label="Entradas esperadas"
              value={proj.totalInflow}
              positive
            />
            <SummaryStat
              label="Salidas programadas"
              value={proj.totalOutflow}
              negative
            />
            <SummaryStat
              label="Saldo proyectado"
              value={proj.closingBalance}
              highlight={belowFloor}
            />
          </div>

          <div className="mt-4">
            <CashProjectionChart projection={proj} />
          </div>

          {belowFloor && (
            <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
              Saldo mínimo proyectado <Currency amount={proj.minBalance} /> el {proj.minBalanceDate}
              {" "}cruza el piso configurable de{" "}
              <Currency amount={proj.safetyFloor} />.
            </div>
          )}
        </CardContent>
      </Card>
    </QuestionSection>
  );
}

function SummaryStat({
  label,
  value,
  positive,
  negative,
  highlight,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
  highlight?: boolean;
}) {
  const color = positive
    ? "text-success"
    : negative
      ? "text-danger"
      : highlight
        ? "text-warning"
        : "text-foreground";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>
        {formatCurrencyMXN(value, { compact: true })}
      </div>
    </div>
  );
}

/* ── F7 Bank detail ──────────────────────────────────────────────────── */
async function BankDetailBlock() {
  const accounts = await getBankDetail();
  return <BankDetailExpand accounts={accounts} />;
}
