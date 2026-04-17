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
  DataViewChart,
  TableExportButton,
  SectionNav,
  MobileCard,
  Currency,
  MetricRow,
  EmptyState,
  type DataTableColumn,
  type DataViewChartSpec,
} from "@/components/shared/v2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  getCfoSnapshot,
  getFinancialRunway,
  getWorkingCapital,
  getCashPosition,
  getPlHistory,
  getCashflowRecommendations,
  getProjectedCashFlow,
  getWorkingCapitalCycle,
  getPartnerPaymentProfiles,
  getJournalFlowProfiles,
  getAccountPaymentProfiles,
  getArZombies,
  type BankBalance,
  type PlPoint,
} from "@/lib/queries/finance";
import { formatCurrencyMXN, formatRelative } from "@/lib/formatters";

import { PlHistoryChart } from "./_components/pl-history-chart";
import { ProjectedCashFlowChart } from "./_components/projected-cash-flow-chart";
import { ProjectedCashFlowTable } from "./_components/projected-cash-flow-table";
import { CashflowRecommendations } from "./_components/cashflow-recommendations";
import { CashflowProfiles } from "./_components/cashflow-profiles";

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
          { id: "recommendations", label: "Recomendaciones" },
          { id: "projection", label: "Proyección 13s" },
          { id: "cycle", label: "Ciclo CxT" },
          { id: "pl", label: "P&L 12m" },
          { id: "cash", label: "Posición de caja" },
          { id: "profiles", label: "Perfiles" },
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

      <section id="recommendations" className="scroll-mt-24">
      {/* Recomendaciones ejecutivas basadas en la situación de liquidez */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recomendaciones del director financiero
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Análisis automático de liquidez, acciones priorizadas por impacto,
            top clientes a cobrar y top proveedores a negociar.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-3">
                <Skeleton className="h-[80px] rounded-xl" />
                <Skeleton className="h-[120px] rounded-xl" />
                <Skeleton className="h-[200px] rounded-xl" />
              </div>
            }
          >
            <RecommendationsSection />
          </Suspense>
        </CardContent>
      </Card>
      </section>

      <section id="projection" className="scroll-mt-24">
      {/* Flujo de efectivo proyectado 13 semanas (v2 método directo) */}
      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Flujo de efectivo proyectado · 13 semanas
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Método directo · AR/SO/AP/PO ponderados por behavior real del
              cliente, nómina quincenal desde cuentas contables, ajuste por pagos
              no conciliados y cash clasificado (operativo / en tránsito / restringido).
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

      <section id="profiles" className="scroll-mt-24">
      {/* Perfiles estadísticos v3 · validación */}
      <div className="mb-3">
        <h2 className="text-base font-semibold">Perfiles de cashflow</h2>
        <p className="text-xs text-muted-foreground">
          Comportamiento de pago real derivado de los últimos 24 meses de
          movimientos bancarios. Fuente del próximo modelo v3 de proyección.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-[240px] rounded-xl" />
            <Skeleton className="h-[240px] rounded-xl" />
            <Skeleton className="h-[240px] rounded-xl" />
          </div>
        }
      >
        <CashflowProfilesSection />
      </Suspense>
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

  // Usa el MÍNIMO entre runway neto (con AR esperada) y cash-only (peor caso).
  // El banner tonea por el peor caso para no dar falsa sensación de liquidez —
  // "23 días si cobro todo" vs "7 días si no cobro nada" es una diferencia
  // que el CEO necesita ver antes de tomar decisiones.
  const worstDays = Math.min(runway.runwayDaysNet, runway.runwayDaysCashOnly);
  const tone =
    worstDays <= 7
      ? "danger"
      : worstDays <= 30
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
          <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold tabular-nums ${iconColor}`}>
                {runway.runwayDaysCashOnly}
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                días cash-only
              </span>
            </div>
            <span className="text-muted-foreground">·</span>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums">
                {runway.runwayDaysNet}
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                días con AR esperada
              </span>
            </div>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Burn diario{" "}
            <Currency amount={runway.burnRateDaily} compact /> · Posición neta
            30d{" "}
            <Currency amount={runway.netPosition30d} compact colorBySign /> ·
            ver sección <a className="underline" href="#projection">Proyección 13s</a>
            {" "}para flujo semanal.
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
  const [cfo, zombies] = await Promise.all([
    getCfoSnapshot(),
    getArZombies(),
  ]);
  if (!cfo) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin datos del CFO dashboard"
        description="La vista cfo_dashboard no devolvió resultados."
      />
    );
  }

  // Separa cartera cobrable real de zombies (>1 año): da al CEO visibilidad
  // sobre qué parte del total es viable vs qué debería write-off.
  const carteraCobrable = Math.max(0, cfo.carteraVencida - zombies.totalMxn);
  const zombieHint = zombies.count > 0
    ? `${zombies.count} facturas >1 año · ${(zombies.totalMxn / 1000).toFixed(0)}K incobrable`
    : undefined;

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Efectivo operativo"
        value={cfo.efectivoTotalMxn}
        format="currency"
        compact
        icon={Wallet}
        subtitle={`MXN $${(cfo.efectivoMxn / 1000).toFixed(0)}K · USD ${cfo.efectivoUsd.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`}
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
        value={carteraCobrable}
        format="currency"
        compact
        icon={AlertTriangle}
        subtitle={
          zombieHint
            ? `${cfo.clientesMorosos} morosos · ${zombieHint}`
            : `${cfo.clientesMorosos} clientes morosos`
        }
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
  // Diferencia 30d debe ser CAJA vs CAJA (cobros reales vs pagos reales),
  // no devengado (ventas facturadas) vs caja (pagos). `pagosProv30d` viene
  // negativo de la vista, por eso se SUMA.
  const flujoNeto = cfo.cobros30d + cfo.pagosProv30d;
  return (
    <div className="space-y-1">
      <MetricRow
        label="Ventas 30d"
        value={cfo.ventas30d}
        format="currency"
        compact
        hint="facturado · no necesariamente cobrado"
      />
      <MetricRow
        label="Cobros 30d"
        value={cfo.cobros30d}
        format="currency"
        compact
        hint="cash real recibido"
      />
      <MetricRow
        label="Pagos a proveedores 30d"
        value={Math.abs(cfo.pagosProv30d)}
        format="currency"
        compact
        hint="cash real desembolsado"
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
        <span>Flujo neto 30d (caja)</span>
        <Currency amount={flujoNeto} compact colorBySign />
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
        label="Capital de trabajo financiero"
        value={wc.capitalDeTrabajo}
        format="currency"
        compact
        hint="efectivo + CxC − CxP"
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
    header: "Saldo nativo",
    cell: (r) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {r.moneda && r.moneda !== "MXN"
          ? `${r.moneda} ${r.saldo.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "—"}
      </span>
    ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "saldoMxn",
    header: "Saldo MXN",
    cell: (r) => <Currency amount={r.saldoMxn} colorBySign />,
    align: "right",
    summary: (rows) => {
      const total = rows.reduce((s, r) => s + (r.saldoMxn ?? 0), 0);
      return (
        <span className="font-bold">
          <Currency amount={total} compact colorBySign />
        </span>
      );
    },
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

  // Aggregate MXN-equivalent balance by currency for donut composition.
  const byCurrency = new Map<string, number>();
  for (const r of rows) {
    const key = r.moneda ?? "MXN";
    byCurrency.set(key, (byCurrency.get(key) ?? 0) + (r.saldoMxn ?? 0));
  }
  const currencyData = Array.from(byCurrency.entries())
    .map(([moneda, saldoMxn]) => ({ moneda, saldoMxn }))
    .sort((a, b) => b.saldoMxn - a.saldoMxn);
  const totalMxn = currencyData.reduce((s, r) => s + r.saldoMxn, 0);
  const donutChart: DataViewChartSpec = {
    type: "donut",
    xKey: "moneda",
    series: [{ dataKey: "saldoMxn", label: "Saldo MXN" }],
    valueFormat: "currency-compact",
    donutCenterLabel: formatCurrencyMXN(totalMxn, { compact: true }),
    height: 240,
  };
  return (
    <div className="space-y-4">
      {currencyData.length > 1 ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Composición por moneda (MXN equivalente)
          </div>
          <DataViewChart
            data={currencyData as unknown as Record<string, unknown>[]}
            chart={donutChart}
          />
        </div>
      ) : null}
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
            ...(r.moneda && r.moneda !== "MXN"
              ? [{
                  label: `Saldo ${r.moneda}`,
                  value: (
                    <span className="tabular-nums">
                      {r.saldo.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ),
                }]
              : []),
            {
              label: "Saldo MXN",
              value: <Currency amount={r.saldoMxn} colorBySign />,
            },
          ]}
        />
      )}
      />
    </div>
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
          label="Capital atrapado operativo"
          value={<Currency amount={wcc.workingCapitalMxn} compact />}
          hint="AR + inventario − AP"
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
// Projected Cash Flow — 13 weeks
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

async function ProjectedCashFlowSection() {
  const { summary, weeks } = await getProjectedCashFlow();

  if (!summary || weeks.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Sin datos de proyección"
        description="La vista projected_cash_flow_weekly no devolvió resultados. Verifica que la migración 20260415_projected_cash_flow_v2.sql esté aplicada."
      />
    );
  }

  const chartData = [
    {
      label: "Hoy",
      inflows: 0,
      outflows: 0,
      closingBalance: summary.cash.effectiveMxn,
    },
    ...weeks.map((w) => ({
      label: shortWeekLabel(w.weekStart, w.weekIndex),
      inflows: w.inflowsWeighted,
      outflows: w.outflowsWeighted,
      closingBalance: w.closingBalance,
    })),
  ];

  const minClose = summary.totals13w.minClosingBalance ?? 0;
  const minToneClass =
    minClose < 0
      ? "border-l-danger bg-danger/5"
      : minClose < 100000
        ? "border-l-warning bg-warning/5"
        : "border-l-success bg-success/5";

  const effectiveCash = summary.cash.effectiveMxn;
  const apOverdue = summary.openPositions.apOverdueMxn;
  const arOverdue = summary.openPositions.arOverdueMxn;
  const unrecHasData =
    summary.unreconciled.unmatchedInboundMxn > 0 ||
    summary.unreconciled.unmatchedOutboundMxn > 0;

  return (
    <div className="space-y-6">
      {/* Alert crítico — semana con cierre negativo */}
      {summary.firstNegativeWeek && (
        <Card className={cn("gap-0 border-l-4 py-0", minToneClass)}>
          <CardContent className="flex items-start gap-3 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-danger">
                Saldo negativo proyectado en semana {summary.firstNegativeWeek.weekIndex + 1}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Cierre estimado{" "}
                <Currency
                  amount={summary.firstNegativeWeek.closingBalance}
                  compact
                  colorBySign
                />{" "}
                para la semana del {summary.firstNegativeWeek.weekStart}. Revisar
                cobranza y posponer pagos no críticos.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Desglose del cash actual */}
      <Card className="gap-0 py-0">
        <CardContent className="flex flex-wrap items-baseline gap-x-8 gap-y-3 px-4 py-3 text-xs">
          <CashChip label="Cash operativo" amount={summary.cash.operativeMxn} />
          {summary.cash.inTransitMxn !== 0 && (
            <CashChip
              label={`En tránsito (${summary.cash.inTransitAccounts})`}
              amount={summary.cash.inTransitMxn}
              signed
            />
          )}
          {summary.cash.ccDebtMxn !== 0 && (
            <CashChip label="Deuda TC" amount={summary.cash.ccDebtMxn} signed />
          )}
          {summary.cash.restrictedMxn !== 0 && (
            <CashChip label="Restringido" amount={summary.cash.restrictedMxn} muted />
          )}
          <div className="ml-auto flex items-baseline gap-6">
            <div className="text-right">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Efectivo efectivo
              </p>
              <p className="text-lg font-bold tabular-nums">
                <Currency amount={effectiveCash} compact />
              </p>
            </div>
            {summary.cash.usdRate && (
              <Badge variant="outline" className="font-mono">
                USD {summary.cash.usdRate.toFixed(2)}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* KPIs del horizonte */}
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Efectivo hoy"
          value={effectiveCash}
          format="currency"
          compact
          icon={Wallet}
          subtitle="operativo + en tránsito"
          tone={effectiveCash >= 0 ? "success" : "danger"}
          size="sm"
        />
        <KpiCard
          title="Entradas 13s"
          value={summary.totals13w.inflowsWeighted}
          format="currency"
          compact
          icon={ArrowDownCircle}
          subtitle={`gross ${compactMxn(summary.totals13w.inflowsGross)}`}
          tone="success"
          size="sm"
        />
        <KpiCard
          title="Salidas 13s"
          value={summary.totals13w.outflowsWeighted}
          format="currency"
          compact
          icon={ArrowUpCircle}
          subtitle={`gross ${compactMxn(summary.totals13w.outflowsGross)}`}
          tone="danger"
          size="sm"
        />
        <KpiCard
          title="Saldo mínimo"
          value={minClose}
          format="currency"
          compact
          icon={Flame}
          subtitle={`Neto 13s ${formatSign(summary.totals13w.netFlow)}`}
          tone={
            minClose < 0
              ? "danger"
              : minClose < 100000
                ? "warning"
                : "success"
          }
          size="sm"
        />
      </StatGrid>

      {/* Chart */}
      <ProjectedCashFlowChart data={chartData} />

      {/* Posiciones abiertas + fuentes recurrentes */}
      <Card className="gap-0 py-0">
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-sm">Posiciones abiertas</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PositionStat
              label="CxC abierta"
              amount={summary.openPositions.arTotalMxn}
              hint={`${compactMxn(arOverdue)} vencido`}
            />
            <PositionStat
              label="CxP abierta"
              amount={summary.openPositions.apTotalMxn}
              hint={`${compactMxn(apOverdue)} vencido`}
              alert={apOverdue > effectiveCash}
            />
            <PositionStat
              label="SO backlog"
              amount={summary.openPositions.soBacklogMxn}
              hint="pendiente facturar"
            />
            <PositionStat
              label="PO backlog"
              amount={summary.openPositions.poBacklogMxn}
              hint="pendiente recibir"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="text-sm">Fuentes recurrentes</CardTitle>
          <CardDescription className="text-xs">
            Promedio de los últimos 3 meses cerrados
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <PositionStat
              label="Nómina mensual"
              amount={summary.recurringSources.payroll.monthlyMxn}
              hint={summary.recurringSources.payroll.periods ?? undefined}
              badge={`${summary.recurringSources.payroll.monthsUsed}m avg`}
            />
            <PositionStat
              label="OpEx mensual"
              amount={summary.recurringSources.opex.monthlyMxn}
              hint={summary.recurringSources.opex.periods ?? undefined}
              badge={`${summary.recurringSources.opex.monthsUsed}m avg`}
            />
            <PositionStat
              label="IVA neto mensual"
              amount={summary.recurringSources.tax.monthlyMxn}
              hint={
                summary.recurringSources.tax.monthlyMxn === 0
                  ? "a favor / sin pago"
                  : "pagado día 17"
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Unreconciled warning */}
      {unrecHasData && (
        <Card className="gap-0 border-l-4 border-l-warning bg-warning/5 py-0">
          <CardContent className="px-4 py-3 text-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="font-medium text-warning">
                  Ajuste por pagos no conciliados activo
                </p>
                <p className="mt-1 text-muted-foreground">
                  {summary.unreconciled.nUnmatchedInbound} pagos inbound por{" "}
                  <Currency
                    amount={summary.unreconciled.unmatchedInboundMxn}
                    compact
                  />{" "}
                  y {summary.unreconciled.nUnmatchedOutbound} outbound por{" "}
                  <Currency
                    amount={summary.unreconciled.unmatchedOutboundMxn}
                    compact
                  />{" "}
                  ya golpearon el banco pero sus facturas siguen abiertas. Se
                  restan de CxC/CxP en la semana 1 para evitar doble conteo.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabla detallada */}
      <ProjectedCashFlowTable weeks={weeks} />
    </div>
  );
}

function CashChip({
  label,
  amount,
  signed = false,
  muted = false,
}: {
  label: string;
  amount: number;
  signed?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-semibold tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        <Currency amount={amount} compact colorBySign={signed} />
      </p>
    </div>
  );
}

function PositionStat({
  label,
  amount,
  hint,
  alert = false,
  badge,
}: {
  label: string;
  amount: number;
  hint?: string;
  alert?: boolean;
  badge?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {badge && (
          <Badge variant="secondary" className="h-4 text-[9px]">
            {badge}
          </Badge>
        )}
      </div>
      <p
        className={cn(
          "mt-0.5 text-lg font-bold tabular-nums",
          alert && "text-destructive",
        )}
      >
        <Currency amount={amount} compact />
      </p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function compactMxn(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function formatSign(n: number): string {
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

// ──────────────────────────────────────────────────────────────────────────
// Recommendations Section
// ──────────────────────────────────────────────────────────────────────────
async function RecommendationsSection() {
  const data = await getCashflowRecommendations();
  if (!data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sin recomendaciones"
        description="La RPC get_cashflow_recommendations no devolvió resultados."
      />
    );
  }
  return <CashflowRecommendations data={data} />;
}

// ──────────────────────────────────────────────────────────────────────────
// Cashflow Profiles Section (v3 validation)
// ──────────────────────────────────────────────────────────────────────────
async function CashflowProfilesSection() {
  const [inboundPartners, outboundPartners, journals, accounts] = await Promise.all([
    getPartnerPaymentProfiles("inbound", 0.5, 25),
    getPartnerPaymentProfiles("outbound", 0.5, 25),
    getJournalFlowProfiles(),
    getAccountPaymentProfiles(),
  ]);
  return (
    <CashflowProfiles
      inboundPartners={inboundPartners}
      outboundPartners={outboundPartners}
      journals={journals}
      accounts={accounts}
    />
  );
}

