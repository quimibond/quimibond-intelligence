import { Suspense } from "react";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
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
  getWorkingCapitalCycle,
  type BankBalance,
  type PlPoint,
} from "@/lib/queries/finance";
import { formatRelative } from "@/lib/formatters";

import { PlHistoryChart } from "./_components/pl-history-chart";

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
        subtitle="Posición ejecutiva, runway y cashflow"
      />

      {/* Runway alert — lo más crítico para el CEO */}
      <Suspense fallback={<Skeleton className="h-24 rounded-xl" />}>
        <RunwaySection />
      </Suspense>

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

      {/* Cuentas bancarias */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posición de caja</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
            <BanksSection />
          </Suspense>
        </CardContent>
      </Card>
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
