import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Building2,
  CalendarClock,
  CreditCard,
  FileText,
  FileX,
  Flame,
  Globe2,
  Inbox,
  Landmark,
  Receipt,
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
  DriftAlert,
  Currency,
  EmptyState,
  StatusBadge,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { parseHistoryRange } from "@/components/patterns/history-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import {
  getCashKpis,
  getRunwayKpis,
  getPnlKpis,
  getPnlWaterfall,
  getWorkingCapital,
  getCashProjection,
  getBankDetail,
  getDriftSummary,
  getBalanceSheet,
  getAnomaliesSummary,
  getFxExposure,
  getTaxEvents,
  getPnlByAccount,
  getCogsComparison,
  getCogsMonthly,
  getCogsPerProduct,
  parseProjectionHorizon,
  type AnomalyRow,
  type CogsMonthlyPoint,
  type CogsPerProductRow,
} from "@/lib/queries/sp13/finanzas";
import { formatCurrencyMXN } from "@/lib/formatters";
import type { HistoryRange } from "@/components/patterns/history-range";

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
        <AnomaliesBanner />
      </Suspense>

      <Suspense fallback={null}>
        <DriftBanner range={period} />
      </Suspense>

      <SectionNav
        items={[
          { id: "hero", label: "Snapshot" },
          { id: "balance-sheet", label: "Balance" },
          { id: "pnl", label: "P&L" },
          { id: "pnl-by-account", label: "Gastos por cuenta" },
          { id: "working-capital", label: "Capital trabajo" },
          { id: "fx", label: "FX" },
          { id: "tax", label: "Fiscal" },
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

      {/* F3.5 — Balance general */}
      <Suspense
        fallback={<Skeleton className="h-[220px] w-full rounded-lg" />}
      >
        <BalanceSheetBlock />
      </Suspense>

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

      {/* F-PnL by account */}
      <Suspense
        fallback={<Skeleton className="h-[320px] w-full rounded-lg" />}
      >
        <PnlByAccountBlock range={plPeriod} />
      </Suspense>

      {/* F-FX */}
      <Suspense
        fallback={<Skeleton className="h-[200px] w-full rounded-lg" />}
      >
        <FxExposureBlock />
      </Suspense>

      {/* F-Tax */}
      <Suspense
        fallback={<Skeleton className="h-[260px] w-full rounded-lg" />}
      >
        <TaxBlock range={period} />
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

/* ── F3 P&L — contable vs ajustado a materia prima ───────────────────── */
async function PnlBlock({ range }: { range: HistoryRange }) {
  const [kpis, waterfall, cogs, monthly, perProduct] = await Promise.all([
    getPnlKpis(range),
    getPnlWaterfall(range),
    getCogsComparison(range),
    getCogsMonthly(range),
    getCogsPerProduct(range),
  ]);

  const hasData = kpis.monthsCovered > 0;
  const utilidadBrutaContable = cogs.revenueMxn - cogs.cogsContableMxn;
  const utilidadBrutaAjustada = cogs.revenueMxn - cogs.cogsRecursiveMpMxn;
  const assetSaleGap = cogs.revenueInvoicesMxn - cogs.revenueMxn;

  return (
    <QuestionSection
      id="pnl"
      question="¿Cómo va mi P&L contable vs el real (sin overhead)?"
      subtext={`Ventas de producto (cuenta 4xx) · COGS contable (501.xx) vs COGS recursivo a materia prima · ${cogs.periodLabel}`}
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
          {/* Fila 1 — Ingresos split: 4xx vs 7xx */}
          <StatGrid columns={{ mobile: 1, tablet: 4, desktop: 4 }}>
            <KpiCard
              title="Ventas de producto"
              value={kpis.ingresosPl}
              format="currency"
              compact
              icon={TrendingUp}
              source="pl"
              tone="success"
              subtitle={
                assetSaleGap > 1_000_000
                  ? `+${formatCurrencyMXN(assetSaleGap, { compact: true })} venta de activo (7xx) NO incluida`
                  : kpis.driftPct == null
                    ? undefined
                    : `drift SAT vs P&L: ${kpis.driftPct.toFixed(1)}%`
              }
              definition={{
                title: "Ventas de producto (cuenta 4xx)",
                description:
                  "Ingresos por venta de producto exclusivamente. Excluye cuenta 7xx (otros ingresos: FX, intereses, venta de activo fijo).",
                formula:
                  "SUM(-balance) WHERE balance_sheet_bucket='income' AND account_code LIKE '4%'",
                table: "canonical_account_balances",
              }}
            />
            <KpiCard
              title="Otros ingresos netos"
              value={kpis.otrosIngresosNetoMxn}
              format="currency"
              compact
              icon={Globe2}
              source="pl"
              tone={kpis.otrosIngresosNetoMxn >= 0 ? "info" : "warning"}
              subtitle="FX, intereses, venta de activo (cuenta 7xx)"
              definition={{
                title: "Otros ingresos netos (cuenta 7xx)",
                description:
                  "Ganancia/pérdida cambiaria, intereses, utilidad/pérdida en venta de activo fijo. Se separan porque no son ventas y distorsionan el margen bruto.",
                formula:
                  "SUM(-balance) WHERE balance_sheet_bucket='income' AND account_code LIKE '7%'",
                table: "canonical_account_balances",
              }}
            />
            <KpiCard
              title="COGS contable"
              value={cogs.cogsContableMxn}
              format="currency"
              compact
              icon={Receipt}
              source="pl"
              tone="warning"
              subtitle={
                cogs.cogsCapaValoracionMxn > 0
                  ? `raw ${formatCurrencyMXN(cogs.cogsContableRawMxn, { compact: true })} − capa ${formatCurrencyMXN(cogs.cogsCapaValoracionMxn, { compact: true })}`
                  : "sin ajuste de capa en el período"
              }
              definition={{
                title: "COGS contable (cuenta 501.xx)",
                description:
                  "Costo de ventas contable actual. Ya refleja el ajuste manual del diario CAPA DE VALORACIÓN si se aplicó. El raw = contable + capa.",
                formula: "SUM(balance) WHERE account_type='expense_direct_cost'",
                table: "canonical_account_balances",
              }}
            />
            <KpiCard
              title="COGS ajustado (BOM → MP)"
              value={cogs.cogsRecursiveMpMxn}
              format="currency"
              compact
              icon={Receipt}
              source="canonical"
              tone="info"
              subtitle={
                cogs.bomCoveragePct < 95
                  ? `⚠ cobertura BOM ${cogs.bomCoveragePct.toFixed(0)}%`
                  : `cobertura ${cogs.bomCoveragePct.toFixed(0)}% · ${cogs.invoiceLinesWithBom}/${cogs.invoiceLinesTotal} líneas`
              }
              definition={{
                title: "COGS ajustado recursivo a materia prima",
                description:
                  "Σ(qty × costo_MP_recursivo) por producto vendido. Explota la BOM primaria hasta llegar a hojas (MP comprada) y suma qty × avg_cost_mxn. Solo material, sin labor ni overhead de sub-ensambles.",
                formula:
                  "Σ(line.qty × get_bom_raw_material_cost_per_unit(product_id))",
                table: "odoo_invoice_lines + mrp_boms + canonical_products",
              }}
            />
          </StatGrid>

          {/* Fila 2 — Utilidad bruta & overhead */}
          <StatGrid columns={{ mobile: 1, tablet: 4, desktop: 4 }}>
            <KpiCard
              title="Utilidad bruta contable"
              value={utilidadBrutaContable}
              format="currency"
              compact
              icon={Scale}
              source="pl"
              tone={utilidadBrutaContable > 0 ? "success" : "danger"}
              subtitle={
                cogs.grossMarginContablePct == null
                  ? "sin ingresos"
                  : `margen ${cogs.grossMarginContablePct.toFixed(1)}% · post ajuste capa`
              }
            />
            <KpiCard
              title="Utilidad bruta ajustada (MP)"
              value={utilidadBrutaAjustada}
              format="currency"
              compact
              icon={Scale}
              source="canonical"
              tone={utilidadBrutaAjustada > 0 ? "success" : "danger"}
              subtitle={
                cogs.grossMarginRecursivePct == null
                  ? "sin ingresos"
                  : `margen material ${cogs.grossMarginRecursivePct.toFixed(1)}%`
              }
              definition={{
                title: "Utilidad bruta ajustada a materia prima",
                description:
                  "Ventas 4xx − COGS recursivo MP. Es la utilidad sin mano de obra, energía ni overhead. Mide la creación de valor del material antes del costo de transformar.",
                formula:
                  "ventas_producto_4xx - Σ(line.qty × costo_MP_recursivo)",
                table: "derived",
              }}
            />
            <KpiCard
              title="Overhead real"
              value={cogs.overheadMxn}
              format="currency"
              compact
              icon={Flame}
              source="pl"
              tone={cogs.overheadMxn > 0 ? "warning" : "danger"}
              subtitle={
                cogs.cogsCapaValoracionMxn > 0
                  ? `${cogs.overheadPctOfRaw.toFixed(1)}% del raw · ajuste aplicado ${formatCurrencyMXN(cogs.cogsCapaValoracionMxn, { compact: true })}`
                  : `${cogs.overheadPctOfRaw.toFixed(1)}% del raw · sin ajuste aún`
              }
              definition={{
                title: "Overhead real implícito",
                description:
                  "COGS raw (pre-ajuste) − COGS recursivo MP. Representa mano de obra, energía, depreciación y overhead que se cargaron a 501.xx pero no son material puro. Comparar contra el ajuste de capa: si el ajuste es menor que el overhead, el P&L sigue sobre-valorando el costo de ventas.",
                formula: "cogs_raw - cogs_recursive_mp",
                table: "derived",
              }}
            />
            <KpiCard
              title="Utilidad neta"
              value={kpis.utilidadNeta}
              format="currency"
              compact
              icon={TrendingDown}
              source="pl"
              tone={kpis.utilidadNeta >= 0 ? "success" : "danger"}
              subtitle={`${kpis.monthsCovered} mes${kpis.monthsCovered === 1 ? "" : "es"} · gastos op ${formatCurrencyMXN(kpis.gastosOperativos, { compact: true })}`}
            />
          </StatGrid>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Waterfall: cómo llego de Ventas a Utilidad neta
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PnlWaterfallChart data={waterfall} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                P&L contable vs solo material (recursivo)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                La columna &ldquo;recursivo&rdquo; reemplaza el COGS contable por el costo
                de material puro (BOM hasta hojas). La Δ es el overhead de
                fabricación (mano de obra directa, energéticos, renta fábrica,
                depreciación maquinaria) que está pegado a 501/504 y no se
                elimina con tu CAPA de valoración.
              </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <PnlCompareTable
                ventas={kpis.ingresosPl}
                cogsContable={cogs.cogsContableMxn}
                cogsRecursivo={cogs.cogsRecursiveMpMxn}
                capaValoracion={cogs.cogsCapaValoracionMxn}
                gastosOp={kpis.gastosOperativos}
                otros={kpis.otrosIngresosNetoMxn}
              />
            </CardContent>
          </Card>

          <Accordion
            type="multiple"
            defaultValue={[]}
            className="rounded-lg border bg-card"
          >
            <AccordionItem value="monthly">
              <AccordionTrigger className="px-4">
                <span className="flex items-center gap-2 text-sm font-medium">
                  Serie mensual · contable vs ajustado
                  {monthly.points.some((p) => p.status !== "ok") && (
                    <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                      {monthly.points.filter((p) => p.status !== "ok").length} meses con alertas
                    </Badge>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <CogsMonthlyTable points={monthly.points} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="per-product">
              <AccordionTrigger className="px-4">
                <span className="flex items-center gap-2 text-sm font-medium">
                  Desglose por producto · {perProduct.rows.length} SKUs
                  {Object.values(perProduct.flagCounts).some((n) => n > 0) && (
                    <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                      {Object.entries(perProduct.flagCounts)
                        .map(([f, n]) => `${n} ${f}`)
                        .join(" · ")}
                    </Badge>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <CogsPerProductTable rows={perProduct.rows} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </QuestionSection>
  );
}

/* Tabla comparativa P&L: contable vs solo material (recursivo) ───────── */
function PnlCompareTable({
  ventas,
  cogsContable,
  cogsRecursivo,
  capaValoracion,
  gastosOp,
  otros,
}: {
  ventas: number;
  cogsContable: number;
  cogsRecursivo: number;
  capaValoracion: number;
  gastosOp: number;
  otros: number;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const pct = (num: number, den: number) =>
    den > 0 ? `${((num / den) * 100).toFixed(1)}%` : "—";

  const bruta_c = ventas - cogsContable;
  const bruta_r = ventas - cogsRecursivo;
  const ebit_c = bruta_c - gastosOp;
  const ebit_r = bruta_r - gastosOp;
  const neta_c = ebit_c + otros;
  const neta_r = ebit_r + otros;

  // Overhead implícito pre-CAPA = COGS raw − MP. Mide todo lo que la
  // CAPA debería remover + lo que se queda pegado.
  const cogsRaw = cogsContable + capaValoracion;
  const overheadImpPre = cogsRaw - cogsRecursivo;
  const overheadImpPost = cogsContable - cogsRecursivo;

  const rows: Array<{
    label: string;
    c: number;
    r: number;
    total?: boolean;
    pct?: boolean;
    tone?: "pos" | "neg" | "muted";
    note?: string;
  }> = [
    { label: "Ventas de producto (4xx)", c: ventas, r: ventas },
    { label: "− COGS", c: -cogsContable, r: -cogsRecursivo, tone: "neg" },
    {
      label: "= Utilidad bruta",
      c: bruta_c,
      r: bruta_r,
      total: true,
      note:
        "Contable: con overhead pegado a 501/504. Recursivo: solo material puro.",
    },
    { label: "Margen %", c: bruta_c, r: bruta_r, pct: true, tone: "muted" },
    { label: "− Gastos op (6xx + dep.)", c: -gastosOp, r: -gastosOp, tone: "neg" },
    { label: "= EBIT", c: ebit_c, r: ebit_r, total: true },
    {
      label: "+ Otros ingresos (7xx)",
      c: otros,
      r: otros,
      tone: otros >= 0 ? "pos" : "neg",
    },
    { label: "= Utilidad neta", c: neta_c, r: neta_r, total: true },
  ];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40%]">Concepto</TableHead>
          <TableHead className="text-right">Contable</TableHead>
          <TableHead className="text-right">Solo MP (recursivo)</TableHead>
          <TableHead className="text-right">Δ (overhead implícito)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => {
          const delta = row.r - row.c;
          const cText = row.pct ? pct(row.c, ventas) : fmt(row.c);
          const rText = row.pct ? pct(row.r, ventas) : fmt(row.r);
          const dText = row.pct
            ? `${(((row.r - row.c) / ventas) * 100).toFixed(1)} pp`
            : fmt(delta);
          return (
            <TableRow
              key={i}
              className={row.total ? "font-semibold bg-muted/40" : ""}
            >
              <TableCell>
                {row.label}
                {row.note && (
                  <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                    {row.note}
                  </p>
                )}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums ${row.tone === "neg" ? "text-destructive" : row.tone === "muted" ? "text-muted-foreground" : ""}`}
              >
                {cText}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums ${row.tone === "neg" ? "text-destructive" : row.tone === "muted" ? "text-muted-foreground" : ""}`}
              >
                {rText}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {dText}
              </TableCell>
            </TableRow>
          );
        })}
        <TableRow className="border-t-2">
          <TableCell>
            <span className="text-xs text-muted-foreground">
              Overhead implícito TOTAL (raw − MP)
            </span>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Costo contable pre-CAPA vs material puro. Lo que &ldquo;debería&rdquo;
              removerse de 501.xx para dejarlo en material puro (tu CAPA ya
              removió {fmt(capaValoracion)}).
            </p>
          </TableCell>
          <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
            pre-CAPA {fmt(overheadImpPre)}
          </TableCell>
          <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
            post-CAPA {fmt(overheadImpPost)}
          </TableCell>
          <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
            falta {fmt(overheadImpPost)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

/* Tabla mensual contable vs ajustado ─────────────────────────────────── */
function CogsMonthlyTable({ points }: { points: CogsMonthlyPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin datos en el período.
      </p>
    );
  }
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mes</TableHead>
            <TableHead className="text-right">Ventas 4xx</TableHead>
            <TableHead className="text-right">Factura</TableHead>
            <TableHead className="text-right">COGS cont.</TableHead>
            <TableHead className="text-right">Capa</TableHead>
            <TableHead className="text-right">COGS MP</TableHead>
            <TableHead className="text-right">Overhead</TableHead>
            <TableHead className="text-right">Margen cont.</TableHead>
            <TableHead className="text-right">Margen MP</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((p) => (
            <TableRow key={p.period}>
              <TableCell className="font-mono text-xs">{p.period}</TableCell>
              <TableCell className="text-right">{fmt(p.revenueProductMxn)}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {fmt(p.revenueInvoicesMxn)}
              </TableCell>
              <TableCell className="text-right">{fmt(p.cogsContableMxn)}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {p.cogsCapaValoracionMxn > 0 ? fmt(p.cogsCapaValoracionMxn) : "—"}
              </TableCell>
              <TableCell className="text-right">{fmt(p.cogsRecursiveMpMxn)}</TableCell>
              <TableCell className="text-right">{fmt(p.overheadMxn)}</TableCell>
              <TableCell className="text-right">{pct(p.marginContablePct)}</TableCell>
              <TableCell className="text-right">{pct(p.marginRecursivePct)}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    p.status === "alert"
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : p.status === "warn"
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-success/40 bg-success/10 text-success"
                  }
                >
                  {p.status}
                </Badge>
                {p.note && (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {p.note}
                  </p>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* Tabla por producto con flags ──────────────────────────────────────── */
function CogsPerProductTable({ rows }: { rows: CogsPerProductRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin ventas de producto en el período.
      </p>
    );
  }
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const sorted = [...rows].sort(
    (a, b) => Math.abs(b.revenueInvoiceMxn) - Math.abs(a.revenueInvoiceMxn)
  );
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ref</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Ingreso</TableHead>
            <TableHead className="text-right">COGS MP</TableHead>
            <TableHead className="text-right">Margen</TableHead>
            <TableHead>Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.productId}>
              <TableCell className="font-mono text-xs">
                {r.productRef ?? (
                  <span className="text-muted-foreground italic">sin ref</span>
                )}
              </TableCell>
              <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                {r.productName ?? ""}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.qtySold.toLocaleString("es-MX", { maximumFractionDigits: 1 })}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmt(r.revenueInvoiceMxn)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmt(r.cogsRecursiveTotalMxn)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {r.flags.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {r.flags.map((f) => (
                      <Badge
                        key={f}
                        variant="outline"
                        className="border-warning/40 bg-warning/10 text-[10px] text-warning"
                      >
                        {f.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
          subtitle={`vencido ${formatCurrencyMXN(wc.arOverdueMxn, { compact: true })} · ${wc.arCompaniesCount} clientes`}
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
          subtitle={`vencido ${formatCurrencyMXN(wc.apOverdueMxn, { compact: true })} · ${wc.apCompaniesCount} proveedores · ${wc.apOverdueCount} fx vencidas`}
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
    overdueCount: number;
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Vencido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.companyId ?? r.companyName ?? i}>
                  <TableCell>
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
                      {r.overdueCount > 0 && (
                        <span className="text-warning">
                          {" "}· {r.overdueCount} vencida{r.overdueCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Currency amount={r.totalMxn} />
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.overdueMxn > 0 ? "text-danger" : "text-muted-foreground"
                    }`}
                  >
                    {r.overdueMxn > 0 ? (
                      <Currency amount={r.overdueMxn} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
      subtext={
        proj.avgCollectionProbability != null
          ? `Saldo proyectado · AR ponderado por probabilidad histórica (avg ${Math.round(proj.avgCollectionProbability * 100)}%)`
          : "Saldo proyectado basado en due dates del AR/AP abierto"
      }
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

          {proj.overdueInflowCount > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">
                <AlertTriangle className="mr-1 size-3" aria-hidden />
                {proj.overdueInflowCount} entradas ya vencidas
              </Badge>
              <span>
                Entradas esperadas (ponderadas):{" "}
                <Currency amount={proj.totalInflow} /> de{" "}
                <Currency amount={proj.totalInflowNominal} /> nominales.
              </span>
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

/* ── Anomalies banner ────────────────────────────────────────────────── */
async function AnomaliesBanner() {
  const anom = await getAnomaliesSummary();
  const hotCount = anom.criticalCount + anom.highCount;
  if (hotCount === 0) return null;

  const severity: "critical" | "warning" =
    anom.criticalCount > 0 ? "critical" : "warning";

  const title =
    anom.criticalCount > 0
      ? `${anom.criticalCount} anomalía${anom.criticalCount === 1 ? "" : "s"} crítica${anom.criticalCount === 1 ? "" : "s"} · ${anom.highCount} de alta prioridad`
      : `${anom.highCount} anomalía${anom.highCount === 1 ? "" : "s"} de alta prioridad`;

  const description = buildAnomaliesDescription(anom.topItems);

  return (
    <DriftAlert
      severity={severity}
      title={title}
      description={description}
      action={{ label: "Ver todo", href: "/sistema?tab=anomalies" }}
    />
  );
}

function buildAnomaliesDescription(items: AnomalyRow[]): string {
  if (items.length === 0) return "Revisa el panel de anomalías para el detalle.";
  return items
    .slice(0, 2)
    .map((it) => it.description || `${it.anomalyType} · ${it.companyName ?? "—"}`)
    .join(" · ");
}

/* ── F3.5 Balance sheet ──────────────────────────────────────────────── */
async function BalanceSheetBlock() {
  const bs = await getBalanceSheet();
  const fresh = isFresh(bs?.asOfDate, 48);

  return (
    <QuestionSection
      id="balance-sheet"
      question="¿Cómo está mi balance?"
      subtext={
        bs
          ? `Activo · pasivo · capital al cierre de ${formatPeriod(bs.period)}`
          : undefined
      }
      actions={
        bs?.asOfDate ? (
          <span title={bs.asOfDate}>
            <StatusBadge
              kind="staleness"
              value={fresh ? "fresh" : "stale"}
              density="regular"
            />
          </span>
        ) : null
      }
    >
      {!bs ? (
        <EmptyState
          icon={FileX}
          title="Sin balance disponible"
          description="El refresco de gold_balance_sheet no ha corrido todavía."
        />
      ) : (
        <>
          <StatGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
            <KpiCard
              title="Activo total"
              value={bs.totalAssetsMxn}
              format="currency"
              compact
              icon={Building2}
              source="pl"
              tone="info"
              subtitle={`${bucketAccountCount(bs.buckets, "asset")} cuentas`}
              definition={{
                title: "Activo total",
                description:
                  "Suma de cuentas tipo asset (caja, bancos, cuentas por cobrar, inventario, activo fijo, etc.)",
                formula: "SUM(balance WHERE balance_sheet_bucket='asset')",
                table: "gold_balance_sheet",
              }}
            />
            <KpiCard
              title="Pasivo total"
              value={bs.totalLiabilitiesMxn}
              format="currency"
              compact
              icon={Landmark}
              source="pl"
              tone="warning"
              subtitle={`${bucketAccountCount(bs.buckets, "liability")} cuentas · D/E ${bs.debtToEquityRatio ?? "—"}`}
              definition={{
                title: "Pasivo total",
                description:
                  "Suma de cuentas tipo liability (CxP, impuestos por pagar, pasivos de largo plazo).",
                formula: "|SUM(balance WHERE balance_sheet_bucket='liability')|",
                table: "gold_balance_sheet",
              }}
            />
            <KpiCard
              title="Capital"
              value={bs.totalEquityMxn}
              format="currency"
              compact
              icon={Scale}
              source="pl"
              tone={bs.totalEquityMxn >= 0 ? "success" : "danger"}
              subtitle={`Liquidez ${bs.liquidityRatio ?? "—"}× · Util. vida ${formatCurrencyMXN(bs.netIncomeLifetimeMxn, { compact: true })}`}
              definition={{
                title: "Capital contable",
                description: "Patrimonio de la empresa. Equity = Assets − Liabilities.",
                formula: "|SUM(balance WHERE balance_sheet_bucket='equity')|",
                table: "gold_balance_sheet",
              }}
            />
          </StatGrid>
          {Math.abs(bs.unbalancedAmountMxn) > 1 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
              ⚠ Balance descuadrado por {formatCurrencyMXN(bs.unbalancedAmountMxn, { compact: true })} — revisa asientos sin contrapartida.
            </div>
          )}
        </>
      )}
    </QuestionSection>
  );
}

function bucketAccountCount(
  buckets: Array<{ bucket: string; accountsCount: number }>,
  kind: string
): number {
  return buckets.find((b) => b.bucket === kind)?.accountsCount ?? 0;
}

function formatPeriod(period: string): string {
  const months = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  const [y, m] = period.split("-");
  const idx = Number(m) - 1;
  return `${months[idx] ?? m} ${y?.slice(2) ?? ""}`;
}

function isFresh(isoTimestamp: string | null | undefined, hoursWindow = 24): boolean {
  if (!isoTimestamp) return false;
  const age = Date.now() - new Date(isoTimestamp).getTime();
  return age < hoursWindow * 3600000;
}

/* ── F-PnL by account ───────────────────────────────────────────────── */
async function PnlByAccountBlock({ range }: { range: HistoryRange }) {
  const data = await getPnlByAccount(range, 20);
  const incomeRows = data.rows.filter((r) => r.bucket === "income");
  const expenseRows = data.rows.filter((r) => r.bucket === "expense");

  return (
    <QuestionSection
      id="pnl-by-account"
      question="¿En qué cuentas se me va el dinero?"
      subtext={`Top 20 cuentas con movimiento · ${data.periodLabel} (${data.monthsCovered} mes${data.monthsCovered === 1 ? "" : "es"})`}
    >
      {data.rows.length === 0 ? (
        <EmptyState
          icon={FileX}
          title="Sin movimiento contable en el período"
          description="Ajusta el rango o revisa la sincronización de cuentas."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <PnlAccountTable
            title="Top ingresos"
            rows={incomeRows}
            total={data.totalIncomeMxn}
            tone="success"
          />
          <PnlAccountTable
            title="Top gastos / costos"
            rows={expenseRows}
            total={data.totalExpenseMxn}
            tone="warning"
          />
        </div>
      )}
    </QuestionSection>
  );
}

function PnlAccountTable({
  title,
  rows,
  total,
  tone,
}: {
  title: string;
  rows: Array<{
    accountCode: string;
    accountName: string;
    accountType: string | null;
    balanceMxn: number;
  }>;
  total: number;
  tone: "success" | "warning";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <span
          className={`text-xs font-semibold tabular-nums ${
            tone === "success" ? "text-success" : "text-warning"
          }`}
        >
          {formatCurrencyMXN(total, { compact: true })}
        </span>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState compact icon={Inbox} title="Sin movimiento" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead className="text-right">Saldo MXN</TableHead>
                <TableHead className="text-right">% del total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct = total > 0 ? (r.balanceMxn / total) * 100 : 0;
                return (
                  <TableRow key={r.accountCode}>
                    <TableCell>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {r.accountCode}
                      </div>
                      <div className="text-sm">{r.accountName}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Currency amount={r.balanceMxn} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {pct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ── F-FX exposure ──────────────────────────────────────────────────── */
async function FxExposureBlock() {
  const fx = await getFxExposure();
  const hasExposure = fx.exposure.length > 0;

  return (
    <QuestionSection
      id="fx"
      question="¿Cuánta exposición tengo en moneda extranjera?"
      subtext="Tipo de cambio actual + AR/AP abierto en USD/EUR"
    >
      <StatGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
        {fx.rates.map((r) => (
          <KpiCard
            key={r.currency}
            title={`${r.currency}/MXN`}
            value={r.rate}
            format="number"
            icon={Globe2}
            source="canonical"
            tone={r.isStale ? "warning" : "default"}
            subtitle={
              r.isStale
                ? `STALE · al ${r.rateDate}`
                : `al ${r.rateDate}`
            }
            definition={{
              title: `Tipo de cambio ${r.currency}/MXN`,
              description:
                "Última tasa registrada en canonical_fx_rates con recency_rank=1.",
              formula: "MAX(rate) WHERE recency_rank = 1",
              table: "canonical_fx_rates",
            }}
          />
        ))}
        <KpiCard
          title="Exposición neta extranjera"
          value={fx.netForeignMxn}
          format="currency"
          compact
          icon={Scale}
          source="canonical"
          tone={fx.netForeignMxn >= 0 ? "info" : "warning"}
          subtitle={`AR ${formatCurrencyMXN(fx.arForeignMxn, { compact: true })} − AP ${formatCurrencyMXN(fx.apForeignMxn, { compact: true })}`}
          definition={{
            title: "Exposición neta foreign",
            description:
              "Diferencia entre AR y AP abierto en monedas distintas a MXN. Una variación del tipo de cambio mueve este número proporcionalmente.",
            formula: "SUM(AR_mxn WHERE currency!=MXN) − SUM(AP_mxn WHERE currency!=MXN)",
            table: "canonical_invoices + canonical_fx_rates",
          }}
        />
      </StatGrid>

      {hasExposure && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Detalle por moneda y dirección</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Moneda</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead className="text-right">Facturas</TableHead>
                  <TableHead className="text-right">Monto nativo</TableHead>
                  <TableHead className="text-right">Equivalente MXN</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fx.exposure.map((e) => (
                  <TableRow key={`${e.currency}-${e.direction}`}>
                    <TableCell className="font-mono text-xs">{e.currency}</TableCell>
                    <TableCell>
                      <Badge
                        variant={e.direction === "issued" ? "info" : "warning"}
                        className="text-[10px]"
                      >
                        {e.direction === "issued" ? "AR — me deben" : "AP — yo debo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.invoiceCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.amountNative.toLocaleString("es-MX", { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Currency amount={e.amountMxn} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </QuestionSection>
  );
}

/* ── F-Tax (retenciones + declaraciones SAT) ────────────────────────── */
async function TaxBlock({ range }: { range: HistoryRange }) {
  const tax = await getTaxEvents(range);

  return (
    <QuestionSection
      id="tax"
      question="¿Qué pasa con mi situación fiscal?"
      subtext={`Retenciones recibidas + declaraciones SAT presentadas · ${tax.periodLabel}`}
    >
      <StatGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
        <KpiCard
          title="Retenciones a favor"
          value={tax.retentionsTotalMxn}
          format="currency"
          compact
          icon={Receipt}
          source="sat"
          tone="success"
          subtitle={`${tax.retentionsCount} CFDIs de retención`}
          definition={{
            title: "Impuestos retenidos por terceros",
            description:
              "Suma de monto_total_retenido en CFDIs tipo retención emitidos a Quimibond. Es saldo a favor frente al SAT.",
            formula: "SUM(monto_total_retenido) WHERE event_type='retention'",
            table: "canonical_tax_events",
          }}
        />
        <KpiCard
          title="Pagado al SAT"
          value={tax.taxReturnsTotalMxn}
          format="currency"
          compact
          icon={Landmark}
          source="sat"
          tone="warning"
          subtitle={`${tax.taxReturnsCount} declaraciones presentadas`}
          definition={{
            title: "Declaraciones SAT pagadas",
            description:
              "Suma de return_monto_pagado en declaraciones presentadas durante el período.",
            formula: "SUM(return_monto_pagado) WHERE event_type='tax_return'",
            table: "canonical_tax_events",
          }}
        />
        <KpiCard
          title="Contabilidad electrónica"
          value={tax.electronicAccountingCount}
          format="number"
          icon={FileText}
          source="sat"
          tone={tax.electronicAccountingCount > 0 ? "success" : "warning"}
          subtitle="balanzas / catálogos enviados"
          definition={{
            title: "Cumplimiento contabilidad electrónica",
            description:
              "Balanzas y catálogos de cuentas enviados al SAT — obligación mensual.",
            formula: "COUNT(*) WHERE event_type='electronic_accounting'",
            table: "canonical_tax_events",
          }}
        />
      </StatGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top retenciones recibidas</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {tax.topRetentions.length === 0 ? (
              <div className="px-4 py-6">
                <EmptyState compact icon={Inbox} title="Sin retenciones en el período" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Emisor</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tax.topRetentions.map((r) => (
                    <TableRow key={r.uuid ?? `${r.emisorRfc}-${r.fechaEmision}`}>
                      <TableCell>
                        <div className="text-sm">{r.emisorNombre ?? "—"}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {r.emisorRfc ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{r.tipoRetencion ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Currency amount={r.monto} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top declaraciones pagadas</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {tax.topReturns.length === 0 ? (
              <div className="px-4 py-6">
                <EmptyState compact icon={Inbox} title="Sin declaraciones en el período" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tax.topReturns.map((r, i) => (
                    <TableRow key={r.numeroOperacion ?? `${r.ejercicio}-${r.periodo}-${i}`}>
                      <TableCell>
                        <div className="text-sm">
                          {r.periodo ?? "—"} {r.ejercicio ?? ""}
                        </div>
                        {r.numeroOperacion && (
                          <div className="font-mono text-[11px] text-muted-foreground">
                            #{r.numeroOperacion}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.tipoDeclaracion ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Currency amount={r.montoPagado} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </QuestionSection>
  );
}

