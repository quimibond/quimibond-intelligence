import { Suspense } from "react";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CalendarClock,
  CreditCard,
  Flame,
  Scale,
  TrendingUp,
  Wallet,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  TableExportButton,
  SectionNav,
  MobileCard,
  Currency,
  MetricRow,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getCfoSnapshot,
  getFinancialRunway,
  getWorkingCapital,
  getCashPosition,
  getPlHistory,
  getProjectedCashFlow,
  getWorkingCapitalCycle,
  type BankBalance,
  type PlPoint,
} from "@/lib/queries/finance";
import { formatRelative } from "@/lib/formatters";

import { PlHistoryChart } from "./_components/pl-history-chart";
import { ProjectedCashFlowChart } from "./_components/projected-cash-flow-chart";
import { ProjectedCashFlowTable } from "./_components/projected-cash-flow-table";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Finanzas" };

const monthLabels = [
  "ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic",
];
function formatPeriod(period: string) {
  const [y, m] = period.split("-");
  const idx = Number(m) - 1;
  return `${monthLabels[idx] ?? m} ${y?.slice(2) ?? ""}`;
}

export default function FinanzasPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Finanzas"
        subtitle="¿Cuánto cash tengo, cuánto me dura, y cómo se está moviendo?"
      />

      <SectionNav
        items={[
          { id: "runway", label: "Runway" },
          { id: "kpis", label: "KPIs CFO" },
          { id: "flow", label: "Flujo 30d" },
          { id: "projection", label: "Proyección 13s" },
          { id: "cycle", label: "Ciclo CxT" },
          { id: "pl", label: "P&L 12m" },
          { id: "cash", label: "Posición de caja" },
        ]}
      />

      <section id="runway" className="scroll-mt-24">
      {/* Runway alert — lo más crítico para el CEO */}
      <Suspense fallback={<Skeleton className="h-24 rounded-xl" />}>
        <RunwaySection />
      </Suspense>
      </section>

      <section id="kpis" className="scroll-mt-24">
      {/* KPIs del CFO dashboard */}
      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <CfoKpisSection />
      </Suspense>
      </section>

      <section id="flow" className="scroll-mt-24">
      {/* Flujo 30 días + working capital */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Flujo 30 días</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
              <FlowSection />
            </Suspense>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capital de trabajo</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
              <WorkingCapitalSection />
            </Suspense>
          </CardContent>
        </Card>
      </div>
      </section>

      <section id="projection" className="scroll-mt-24">
      {/* Flujo de efectivo proyectado 13 semanas — v2 */}
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Flujo de efectivo proyectado · 13 semanas
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              CxC ajustada por atraso histórico, CxP comprometidos, nómina
              quincenal, OpEx recurrente y pipeline — todo desde Odoo + CFDI.
            </p>
          </div>
          <TableExportButton filename="projected-cash-flow" />
        </CardHeader>
        <CardContent className="space-y-4 pb-4">
          <Suspense
            fallback={
              <div className="space-y-3">
                <Skeleton className="h-[96px] rounded-xl" />
                <Skeleton className="h-[280px] rounded-xl" />
                <Skeleton className="h-48 rounded-xl" />
              </div>
            }
          >
            <ProjectedCashFlowSection />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="cycle" className="scroll-mt-24">
      {/* Working Capital Cycle — DSO/DPO/DIO/CCC con COGS real */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Ciclo de capital de trabajo
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            DSO + DIO − DPO = CCC. Días entre que comprometemos cash y lo
            recuperamos. COGS desde plan de cuentas oficial.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[96px] rounded-xl" />
                ))}
              </StatGrid>
            }
          >
            <WorkingCapitalCycleSection />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="pl" className="scroll-mt-24">
      {/* P&L chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">P&amp;L últimos 12 meses</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={<Skeleton className="h-[240px] w-full rounded-md" />}
          >
            <PlHistorySection />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="cash" className="scroll-mt-24">
      {/* Cuentas bancarias */}
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">Posición de caja</CardTitle>
          <TableExportButton filename="cash-position" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
            <BanksSection />
          </Suspense>
        </CardContent>
      </Card>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Runway alert — critical CEO-facing band
// ──────────────────────────────────────────────────────────────────────────
async function RunwaySection() {
  const runway = await getFinancialRunway();
  if (!runway) return null;

  const tone =
    runway.runwayDaysNet <= 7
      ? "danger"
      : runway.runwayDaysNet <= 30
        ? "warning"
        : "success";

  const toneClass = {
    danger: "border-danger bg-danger/10",
    warning: "border-warning bg-warning/10",
    success: "border-success bg-success/10",
  }[tone];

  const iconColor = {
    danger: "text-danger",
    warning: "text-warning",
    success: "text-success",
  }[tone];

  return (
    <Card className={`gap-2 border-l-4 ${toneClass}`}>
      <div className="flex items-start gap-3 px-4 py-3">
        <Flame className={`h-5 w-5 shrink-0 ${iconColor}`} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold tabular-nums ${iconColor}`}>
              {runway.runwayDaysNet}
            </span>
            <span className="text-sm font-medium">días de runway</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Burn diario{" "}
            <Currency amount={runway.burnRateDaily} compact /> · Posición neta
            30d{" "}
            <Currency amount={runway.netPosition30d} compact colorBySign />
          </p>
          {runway.computedAt && (
            <p className="text-[10px] text-muted-foreground">
              Actualizado {formatRelative(runway.computedAt)}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CFO KPI grid
// ──────────────────────────────────────────────────────────────────────────
async function CfoKpisSection() {
  const cfo = await getCfoSnapshot();
  if (!cfo) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin datos del CFO dashboard"
        description="La vista cfo_dashboard no devolvió resultados."
      />
    );
  }

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Efectivo disponible"
        value={cfo.efectivoTotalMxn}
        format="currency"
        compact
        icon={Wallet}
        subtitle={`MXN + USD (${cfo.efectivoUsd.toLocaleString("es-MX")} USD)`}
        tone={cfo.efectivoTotalMxn >= 0 ? "success" : "danger"}
      />
      <KpiCard
        title="Deuda tarjetas"
        value={cfo.deudaTarjetas}
        format="currency"
        compact
        icon={CreditCard}
        tone={cfo.deudaTarjetas > 0 ? "warning" : "default"}
      />
      <KpiCard
        title="Posición neta"
        value={cfo.posicionNeta}
        format="currency"
        compact
        icon={Scale}
        subtitle="efectivo − tarjetas"
        tone={cfo.posicionNeta >= 0 ? "success" : "danger"}
      />
      <KpiCard
        title="Cartera vencida"
        value={cfo.carteraVencida}
        format="currency"
        compact
        icon={AlertTriangle}
        subtitle={`${cfo.clientesMorosos} clientes morosos`}
        tone="danger"
        href="/cobranza"
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 30-day flow
// ──────────────────────────────────────────────────────────────────────────
async function FlowSection() {
  const cfo = await getCfoSnapshot();
  if (!cfo) return null;
  const neto = cfo.ventas30d - cfo.pagosProv30d;
  return (
    <div className="space-y-1">
      <MetricRow
        label="Ventas 30d"
        value={cfo.ventas30d}
        format="currency"
        compact
      />
      <MetricRow
        label="Cobros 30d"
        value={cfo.cobros30d}
        format="currency"
        compact
      />
      <MetricRow
        label="Pagos a proveedores 30d"
        value={cfo.pagosProv30d}
        format="currency"
        compact
      />
      <MetricRow
        label="Cuentas por cobrar"
        value={cfo.cuentasPorCobrar}
        format="currency"
        compact
      />
      <MetricRow
        label="Cuentas por pagar"
        value={cfo.cuentasPorPagar}
        format="currency"
        compact
      />
      <div className="mt-2 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm font-semibold">
        <span>Diferencia 30d</span>
        <Currency amount={neto} compact colorBySign />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Working capital + liquidity ratios
// ──────────────────────────────────────────────────────────────────────────
async function WorkingCapitalSection() {
  const wc = await getWorkingCapital();
  if (!wc) return null;
  return (
    <div className="space-y-1">
      <MetricRow
        label="Capital de trabajo"
        value={wc.capitalDeTrabajo}
        format="currency"
        compact
      />
      <MetricRow
        label="Ratio de liquidez"
        value={wc.ratioLiquidez}
        format="number"
        hint="activo corriente ÷ pasivo corriente"
      />
      <MetricRow
        label="Prueba ácida"
        value={wc.ratioPruebaAcida}
        format="number"
        alert={wc.ratioPruebaAcida < 1}
        hint="sin inventarios"
      />
      <MetricRow
        label="Efectivo neto"
        value={wc.efectivoNeto}
        format="currency"
        compact
        alert={wc.efectivoNeto < 0}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// P&L history chart
// ──────────────────────────────────────────────────────────────────────────
async function PlHistorySection() {
  const rows = await getPlHistory(12);
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin datos de P&L"
        description="La vista pl_estado_resultados no tiene datos recientes."
        compact
      />
    );
  }
  return <PlHistoryChart data={rows} />;
}

// ──────────────────────────────────────────────────────────────────────────
// Bank accounts table
// ──────────────────────────────────────────────────────────────────────────
const bankColumns: DataTableColumn<BankBalance>[] = [
  {
    key: "banco",
    header: "Banco",
    cell: (r) => <span className="truncate">{r.banco ?? "—"}</span>,
  },
  {
    key: "tipo",
    header: "Tipo",
    cell: (r) =>
      r.tipo === "bank"
        ? "Banco"
        : r.tipo === "credit"
          ? "Tarjeta"
          : (r.tipo ?? "—"),
    hideOnMobile: true,
  },
  {
    key: "moneda",
    header: "Moneda",
    cell: (r) => <span className="font-mono text-xs">{r.moneda ?? "—"}</span>,
  },
  {
    key: "saldo",
    header: "Saldo",
    cell: (r) => <Currency amount={r.saldo} colorBySign />,
    align: "right",
  },
];

async function BanksSection() {
  const rows = await getCashPosition();
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={Banknote}
        title="Sin cuentas bancarias"
        description="No hay saldos bancarios registrados."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={bankColumns}
      rowKey={(r, i) => `${r.banco ?? "bank"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.banco ?? "—"}
          subtitle={
            r.tipo === "credit"
              ? "Tarjeta de crédito"
              : r.cuenta ?? r.tipo ?? undefined
          }
          fields={[
            { label: "Moneda", value: r.moneda ?? "—" },
            {
              label: "Saldo",
              value: <Currency amount={r.saldo} colorBySign />,
            },
          ]}
        />
      )}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Working Capital Cycle — Sprint 8/10
// ──────────────────────────────────────────────────────────────────────────
function cycleTone(
  metric: "dso" | "dpo" | "dio" | "ccc",
  days: number | null
): "success" | "warning" | "danger" | "default" {
  if (days == null) return "default";
  // Benchmarks textil B2B
  if (metric === "dso") {
    if (days <= 30) return "success";
    if (days <= 50) return "warning";
    return "danger";
  }
  if (metric === "dio") {
    if (days <= 60) return "success";
    if (days <= 90) return "warning";
    return "danger";
  }
  if (metric === "dpo") {
    // DPO alto = bueno (pagamos lento, retenemos cash)
    if (days >= 60) return "success";
    if (days >= 30) return "warning";
    return "danger";
  }
  // CCC
  if (days <= 60) return "success";
  if (days <= 90) return "warning";
  return "danger";
}

async function WorkingCapitalCycleSection() {
  const wcc = await getWorkingCapitalCycle();
  if (!wcc) {
    return (
      <EmptyState
        icon={Scale}
        title="Sin datos de ciclo de capital"
        description="working_capital_cycle no devolvió resultados."
        compact
      />
    );
  }

  return (
    <div className="space-y-4">
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="DSO (cobro)"
          value={wcc.dsoDays ?? 0}
          format="days"
          icon={ArrowDownCircle}
          subtitle="días para cobrar"
          tone={cycleTone("dso", wcc.dsoDays)}
          size="sm"
        />
        <KpiCard
          title="DPO (pago)"
          value={wcc.dpoDays ?? 0}
          format="days"
          icon={ArrowUpCircle}
          subtitle="días para pagar"
          tone={cycleTone("dpo", wcc.dpoDays)}
          size="sm"
        />
        <KpiCard
          title="DIO (inventario)"
          value={wcc.dioDays ?? 0}
          format="days"
          icon={Wallet}
          subtitle="días de stock"
          tone={cycleTone("dio", wcc.dioDays)}
          size="sm"
        />
        <KpiCard
          title="CCC"
          value={wcc.cccDays ?? 0}
          format="days"
          icon={TrendingUp}
          subtitle="días totales en ciclo"
          tone={cycleTone("ccc", wcc.cccDays)}
          size="sm"
        />
      </StatGrid>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricRow
          label="Revenue 12m"
          value={<Currency amount={wcc.revenue12mMxn} compact />}
        />
        <MetricRow
          label="COGS 12m"
          value={<Currency amount={wcc.cogs12mMxn} compact />}
        />
        <MetricRow
          label="Gross margin"
          value={
            <span
              className={
                wcc.grossMarginPct >= 25
                  ? "text-success font-semibold tabular-nums"
                  : wcc.grossMarginPct >= 15
                    ? "text-warning font-semibold tabular-nums"
                    : "text-danger font-semibold tabular-nums"
              }
            >
              {wcc.grossMarginPct.toFixed(1)}%
            </span>
          }
        />
        <MetricRow
          label="Capital atrapado"
          value={<Currency amount={wcc.workingCapitalMxn} compact />}
        />
      </div>

      <p className="text-[10px] text-muted-foreground">
        Benchmarks textil B2B: DSO ≤30 saludable · DIO ≤60 saludable ·
        DPO ≥60 saludable · CCC ≤60 saludable. COGS desde
        odoo_account_balances filtrado por account_type=expense_direct_cost
        (NO el proxy in_invoices).
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Projected Cash Flow — 13 weeks (v2)
// ──────────────────────────────────────────────────────────────────────────
const monthShortPf = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function shortWeekLabel(weekStart: string, weekIndex: number) {
  const [y, m, d] = weekStart.split("-").map((x) => Number(x));
  if (!y || !m || !d) return `S${weekIndex + 1}`;
  return `${d}${monthShortPf[m - 1] ? " " + monthShortPf[m - 1] : ""}`;
}

function scenarioTone(
  min: number
): "success" | "warning" | "danger" {
  if (min < 0) return "danger";
  if (min < 100000) return "warning";
  return "success";
}

function formatSignedCompact(n: number): string {
  if (n === 0) return "neutro";
  const sign = n > 0 ? "+" : "−";
  const abs = Math.abs(n);
  const compact = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(abs);
  return `${sign}${compact}`;
}

async function ProjectedCashFlowSection() {
  const { summary, weeks, topArByWeek } = await getProjectedCashFlow();

  if (!summary || weeks.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Sin datos de proyección"
        description="La vista projected_cash_flow_weekly no devolvió resultados. Verifica que la migración 20260415_projected_cash_flow_v2.sql esté aplicada."
      />
    );
  }

  const chartData = weeks.map((w) => ({
    label: shortWeekLabel(w.weekStart, w.weekIndex),
    inflows: w.inflowsTotal,
    outflows: w.outflowsTotal,
    closingBalance: w.closingBalance,
  }));

  const baseToneClass = {
    danger: "border-danger bg-danger/10",
    warning: "border-warning bg-warning/10",
    success: "border-success bg-success/10",
  }[scenarioTone(summary.minClosingBalance)];

  return (
    <div className="space-y-4">
      {/* Alert band si hay semana con cierre negativo */}
      {summary.firstNegativeWeek && (
        <Card className={`gap-2 border-l-4 ${baseToneClass}`}>
          <div className="flex items-start gap-3 px-4 py-3">
            <AlertTriangle
              className="h-5 w-5 shrink-0 text-danger"
              aria-hidden
            />
            <div className="flex-1 min-w-0 text-sm">
              <p className="font-semibold text-danger">
                Saldo negativo proyectado en semana{" "}
                {summary.firstNegativeWeek.weekIndex + 1}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Cierre estimado{" "}
                <Currency
                  amount={summary.firstNegativeWeek.closingBalance}
                  compact
                  colorBySign
                />{" "}
                para la semana del {summary.firstNegativeWeek.weekStart}.
                Revisar cobranza y posponer pagos no críticos.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* KPIs del horizonte */}
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Efectivo hoy"
          value={summary.cashNow}
          format="currency"
          compact
          icon={Wallet}
          subtitle="bancos − tarjetas"
          tone={summary.cashNow >= 0 ? "success" : "danger"}
          size="sm"
        />
        <KpiCard
          title="Entradas 13s"
          value={summary.totalInflows13w}
          format="currency"
          compact
          icon={ArrowDownCircle}
          subtitle="CxC ajustada"
          tone="success"
          size="sm"
        />
        <KpiCard
          title="Salidas 13s"
          value={summary.totalOutflows13w}
          format="currency"
          compact
          icon={ArrowUpCircle}
          subtitle="CxP + nómina + opex"
          tone="danger"
          size="sm"
        />
        <KpiCard
          title="Saldo mínimo"
          value={summary.minClosingBalance}
          format="currency"
          compact
          icon={Flame}
          subtitle={`Neto 13s ${formatSignedCompact(summary.netFlow13w)}`}
          tone={scenarioTone(summary.minClosingBalance)}
          size="sm"
        />
      </StatGrid>

      {/* Escenarios — stress test del CEO */}
      <div className="grid gap-3 rounded-md border border-border/60 bg-muted/20 p-3 sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Optimista · +10% neto
          </div>
          <div
            className={`mt-1 text-sm font-semibold tabular-nums ${
              scenarioTone(summary.scenarioOptimisticMin) === "danger"
                ? "text-danger"
                : scenarioTone(summary.scenarioOptimisticMin) === "warning"
                  ? "text-warning"
                  : "text-success"
            }`}
          >
            min{" "}
            <Currency amount={summary.scenarioOptimisticMin} compact />
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Base · proyección real
          </div>
          <div
            className={`mt-1 text-sm font-semibold tabular-nums ${
              scenarioTone(summary.scenarioBaseMin) === "danger"
                ? "text-danger"
                : scenarioTone(summary.scenarioBaseMin) === "warning"
                  ? "text-warning"
                  : "text-success"
            }`}
          >
            min <Currency amount={summary.scenarioBaseMin} compact />
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Conservador · −15% CxC, +10% CxP
          </div>
          <div
            className={`mt-1 text-sm font-semibold tabular-nums ${
              scenarioTone(summary.scenarioConservativeMin) === "danger"
                ? "text-danger"
                : scenarioTone(summary.scenarioConservativeMin) === "warning"
                  ? "text-warning"
                  : "text-success"
            }`}
          >
            min{" "}
            <Currency amount={summary.scenarioConservativeMin} compact />
          </div>
        </div>
      </div>

      {/* Chart */}
      <ProjectedCashFlowChart data={chartData} />

      {/* Vencidos acumulados hoy — informativo */}
      {(summary.arOverdueToday > 0 || summary.apOverdueToday > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          <MetricRow
            label="CxC vencida cargada en semana 1"
            value={summary.arOverdueToday}
            format="currency"
            compact
            hint="Cobrable inmediato"
          />
          <MetricRow
            label="CxP vencida cargada en semana 1"
            value={summary.apOverdueToday}
            format="currency"
            compact
            alert={summary.apOverdueToday > summary.cashNow}
            hint="Pagos vencidos a proveedores"
          />
        </div>
      )}

      {/* Tabla detallada + drill-down */}
      <ProjectedCashFlowTable weeks={weeks} topArByWeek={topArByWeek} />
    </div>
  );
}
