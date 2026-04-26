import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Building2,
  CalendarClock,
  ChevronRight,
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
  type CashFlowCategoryTotal,
  type CustomerCashflowRow,
  type ProjectionEvent,
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
  getMpLeavesInventory,
  getTopProductsWithComposition,
  getCashReconciliation,
  parseProjectionHorizon,
  type AnomalyRow,
  type CogsMonthlyPoint,
  type CogsPerProductRow,
  type MpLeafRow,
  type TopProductWithComposition,
  type CashCategoryRow,
  type BalanceSheetCategoryRow,
  getPnlNormalized,
  type PnlAdjustment,
  getObligationsSummary,
  type ObligationCategory,
  getInvoiceDiscrepancies,
  type DiscrepancyCategory,
  type DiscrepancyInvoice,
  periodBoundsForRange,
  getCustomerCreditScores,
  type CustomerCreditScore,
  getCashConversionCycle,
  computeSensitivity,
  type SensitivitySnapshot,
  type CashProjection,
  getSupplierPriorityScores,
  type SupplierPriorityScore,
} from "@/lib/queries/sp13/finanzas";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";
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
          { id: "projection", label: "Proyección" },
          { id: "obligations", label: "Obligaciones" },
          { id: "cash-reconciliation", label: "¿Dónde está el dinero?" },
          { id: "pnl", label: "P&L" },
          { id: "balance-sheet", label: "Balance" },
          { id: "working-capital", label: "Capital trabajo" },
          { id: "mp-quality", label: "Costos de MP" },
          { id: "pnl-by-account", label: "Gastos por cuenta" },
          { id: "discrepancies", label: "Odoo ↔ SAT" },
          { id: "fx", label: "FX" },
          { id: "tax", label: "Fiscal" },
          { id: "bank-detail", label: "Detalle bancario" },
        ]}
      />

      {/* ═══ Diario / accionable ════════════════════════════════════ */}

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

      {/* F5 — Proyección */}
      <Suspense
        fallback={<Skeleton className="h-[380px] w-full rounded-lg" />}
      >
        <ProjectionBlock horizon={horizon} />
      </Suspense>

      {/* F-CREDIT — Score de riesgo crediticio por cliente */}
      <Suspense
        fallback={<Skeleton className="h-[280px] w-full rounded-lg" />}
      >
        <CustomerCreditScoresBlock />
      </Suspense>

      {/* F-PRIORITY — Score de prioridad de pago a proveedores */}
      <Suspense
        fallback={<Skeleton className="h-[280px] w-full rounded-lg" />}
      >
        <SupplierPriorityBlock />
      </Suspense>

      {/* F-CCC — Cash Conversion Cycle */}
      <Suspense
        fallback={<Skeleton className="h-[240px] w-full rounded-lg" />}
      >
        <CashConversionCycleBlock />
      </Suspense>

      {/* F-OBL — Obligaciones */}
      <Suspense
        fallback={<Skeleton className="h-[320px] w-full rounded-lg" />}
      >
        <ObligationsBlock />
      </Suspense>

      {/* F-WTM — ¿Dónde está el dinero? */}
      <Suspense
        fallback={<Skeleton className="h-[380px] w-full rounded-lg" />}
      >
        <CashReconciliationBlock range={period} />
      </Suspense>

      {/* F3 — P&L */}
      <Suspense
        fallback={<Skeleton className="h-[420px] w-full rounded-lg" />}
      >
        <PnlBlock range={period} />
      </Suspense>

      {/* F3.5 — Balance general */}
      <Suspense
        fallback={<Skeleton className="h-[220px] w-full rounded-lg" />}
      >
        <BalanceSheetBlock />
      </Suspense>

      {/* ═══ Drilldowns (collapse-by-default en commit siguiente) ══ */}

      {/* F4 — Working capital */}
      <Suspense
        fallback={<Skeleton className="h-[260px] w-full rounded-lg" />}
      >
        <WorkingCapitalBlock />
      </Suspense>

      {/* F-MP-Q — Calidad de costo primo */}
      <Suspense
        fallback={<Skeleton className="h-[360px] w-full rounded-lg" />}
      >
        <MpQualityBlock range={period} />
      </Suspense>

      {/* F-PnL by account */}
      <Suspense
        fallback={<Skeleton className="h-[320px] w-full rounded-lg" />}
      >
        <PnlByAccountBlock range={period} />
      </Suspense>

      {/* F-DISC — Discrepancias Odoo ↔ SAT */}
      <Suspense
        fallback={<Skeleton className="h-[280px] w-full rounded-lg" />}
      >
        <InvoiceDiscrepanciesBlock range={period} />
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

      {/* F7 — Bank detail */}
      <Suspense fallback={<Skeleton className="h-[160px] w-full rounded-lg" />}>
        <BankDetailBlock />
      </Suspense>
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
  const [kpis, waterfall, cogs, monthly, perProduct, normalized] =
    await Promise.all([
      getPnlKpis(range),
      getPnlWaterfall(range),
      getCogsComparison(range),
      getCogsMonthly(range),
      getCogsPerProduct(range),
      getPnlNormalized(range),
    ]);

  const hasData = kpis.monthsCovered > 0;
  const utilidadBrutaContable = cogs.revenueMxn - cogs.cogsContableMxn;
  const utilidadBrutaAjustada = cogs.revenueMxn - cogs.cogsRecursiveMpMxn;
  const assetSaleGap = cogs.revenueInvoicesMxn - cogs.revenueMxn;

  // ── Break-even analysis ────────────────────────────────────────────
  // Costos fijos del período = todo lo que NO es material (ya está en
  // sus cuentas propias). No cambian con el volumen de ventas (en el
  // corto plazo): nómina, renta, energía, dep, admin.
  const costosFijosFabrica =
    kpis.mod501_06Mxn +
    kpis.compras502Mxn +
    kpis.overhead504_01Mxn +
    kpis.depFabrica504Mxn;
  const costosFijosAdmin = kpis.gastosOp6xxMxn + kpis.depCorpoMxn;
  const costosFijosTotales = costosFijosFabrica + costosFijosAdmin;
  const margenMaterialPct =
    cogs.revenueMxn > 0
      ? (cogs.revenueMxn - cogs.cogsRecursiveMpMxn) / cogs.revenueMxn
      : 0;
  const ventasBreakEven =
    margenMaterialPct > 0 ? costosFijosTotales / margenMaterialPct : 0;
  const gapBreakEven = cogs.revenueMxn - ventasBreakEven;
  const cumplimientoPct =
    ventasBreakEven > 0 ? (cogs.revenueMxn / ventasBreakEven) * 100 : 0;

  return (
    <QuestionSection
      id="pnl"
      question="¿Cómo va mi P&L contable vs el real (sin overhead)?"
      subtext={`Ventas de producto (cuenta 4xx) · COGS contable (501.xx) vs COGS recursivo a materia prima · ${cogs.periodLabel}`}
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
              title="Margen contributivo material"
              value={utilidadBrutaAjustada}
              format="currency"
              compact
              icon={Scale}
              source="canonical"
              tone={utilidadBrutaAjustada > 0 ? "success" : "danger"}
              subtitle={
                cogs.grossMarginRecursivePct == null
                  ? "sin ingresos"
                  : `${cogs.grossMarginRecursivePct.toFixed(1)}% · lo que deja cada peso vendido después de material`
              }
              definition={{
                title: "Margen contributivo material",
                description:
                  "Ventas 4xx − Costo primo real (BOM recursiva a MP). Es lo que queda para cubrir mano de obra, overhead de fábrica, depreciación y gastos operativos. NO es utilidad — es contribución bruta del material.",
                formula:
                  "ventas_producto_4xx - Σ(line.qty × costo_MP_recursivo)",
                table: "derived",
              }}
            />
            <KpiCard
              title="CAPA pendiente del mes"
              value={kpis.cogs501_01Mxn - cogs.cogsRecursiveMpMxn}
              format="currency"
              compact
              icon={Flame}
              source="pl"
              tone={
                Math.abs(kpis.cogs501_01Mxn - cogs.cogsRecursiveMpMxn) < 100000
                  ? "success"
                  : kpis.cogs501_01Mxn - cogs.cogsRecursiveMpMxn > 0
                    ? "warning"
                    : "info"
              }
              subtitle={
                kpis.cogs501_01Mxn - cogs.cogsRecursiveMpMxn > 0
                  ? `501.01 tiene ${formatCurrencyMXN(kpis.cogs501_01Mxn, { compact: true })} vs MP real ${formatCurrencyMXN(cogs.cogsRecursiveMpMxn, { compact: true })} · te falta CAPA`
                  : `501.01 ${formatCurrencyMXN(kpis.cogs501_01Mxn, { compact: true })} < MP real · CAPA en exceso`
              }
              definition={{
                title: "CAPA de valoración pendiente",
                description:
                  "Diferencia entre el saldo actual de 501.01 (post-CAPA aplicada) y el costo primo real de la BOM recursiva. Positivo = overhead aún pegado a 501.01 que deberías remover con CAPA. Negativo = te pasaste. Cero = CAPA perfecta.",
                formula: "501.01_actual − cogs_recursivo_mp",
                table:
                  "canonical_account_balances + get_cogs_recursive_mp",
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
                P&L limpio — costo primo real (BOM recursiva)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                501.01 reemplazado por costo primo real de la BOM recursiva hasta
                materia prima. Los demás costos (mano de obra 501.06, overhead
                fábrica 504.01, depreciación 504.08-23, gastos op 6xx) quedan
                en su cuenta. La CAPA de valoración deshace la duplicación que
                Odoo mete automáticamente a 501.01.
              </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <PnlLimpioTable
                ventas={kpis.ingresosPl}
                costoPrimo={cogs.cogsRecursiveMpMxn}
                cogs501_01Actual={kpis.cogs501_01Mxn}
                mod={kpis.mod501_06Mxn}
                compras={kpis.compras502Mxn}
                overhead={kpis.overhead504_01Mxn}
                depFabrica={kpis.depFabrica504Mxn}
                gastosOp={kpis.gastosOp6xxMxn + kpis.depCorpoMxn}
                otros={kpis.otrosIngresosNetoMxn}
                netaContable={kpis.utilidadNeta}
              />
            </CardContent>
          </Card>

          <PnlNormalizedCard
            reportedNeta={normalized.reportedNetIncomeMxn}
            normalizedNeta={normalized.normalizedNetIncomeMxn}
            totalImpact={normalized.totalAdjustmentImpactMxn}
            adjustments={normalized.adjustments}
            ventas={cogs.revenueMxn}
          />

          <BreakEvenCard
            ventasReales={cogs.revenueMxn}
            ventasBreakEven={ventasBreakEven}
            gap={gapBreakEven}
            cumplimientoPct={cumplimientoPct}
            margenMaterialPct={margenMaterialPct * 100}
            costosFijosFabrica={costosFijosFabrica}
            costosFijosAdmin={costosFijosAdmin}
            costoPrimo={cogs.cogsRecursiveMpMxn}
            monthsCovered={kpis.monthsCovered}
          />

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

/* Tabla P&L limpio con costo primo real (BOM recursiva) ───────────────── */
/* P&L normalizado: separar operación core de one-offs y year-end ───── */
function PnlNormalizedCard({
  reportedNeta,
  normalizedNeta,
  totalImpact,
  adjustments,
  ventas,
}: {
  reportedNeta: number;
  normalizedNeta: number;
  totalImpact: number;
  adjustments: PnlAdjustment[];
  ventas: number;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const detected = adjustments.filter((a) => a.detected);

  if (detected.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">P&L normalizado</CardTitle>
          <p className="text-xs text-muted-foreground">
            En este período no detectamos ajustes year-end ni one-offs
            significativos. La utilidad reportada ({fmt(reportedNeta)})
            refleja la operación core sin distorsiones contables.
          </p>
        </CardHeader>
      </Card>
    );
  }

  const reportedPct = ventas > 0 ? (reportedNeta / ventas) * 100 : 0;
  const normalizedPct = ventas > 0 ? (normalizedNeta / ventas) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          P&L normalizado · operación core vs one-offs
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Quitando ventas de activo, ajustes year-end de inventario, catch-up
          de depreciación y otros ingresos extraordinarios para ver la
          tendencia operativa real (recurrente).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Hero: reportada → normalizada */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-muted/30 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Utilidad reportada
            </div>
            <div
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                reportedNeta >= 0 ? "text-foreground" : "text-destructive"
              )}
            >
              {fmt(reportedNeta)}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {reportedPct >= 0 ? "+" : ""}
              {reportedPct.toFixed(1)}% de ventas
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              ± Ajustes one-off
            </div>
            <div
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                totalImpact > 0
                  ? "text-success"
                  : totalImpact < 0
                    ? "text-destructive"
                    : "text-muted-foreground"
              )}
            >
              {totalImpact >= 0 ? "+" : ""}
              {fmt(totalImpact)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {detected.length} ajuste{detected.length === 1 ? "" : "s"}{" "}
              detectado{detected.length === 1 ? "" : "s"}
            </div>
          </div>
          <div
            className={cn(
              "rounded-md border px-3 py-3",
              normalizedNeta >= 0
                ? "border-success/40 bg-success/10"
                : "border-destructive/40 bg-destructive/10"
            )}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Utilidad normalizada (operación)
            </div>
            <div
              className={cn(
                "mt-1 text-xl font-bold tabular-nums",
                normalizedNeta >= 0 ? "text-success" : "text-destructive"
              )}
            >
              {fmt(normalizedNeta)}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {normalizedPct >= 0 ? "+" : ""}
              {normalizedPct.toFixed(1)}% de ventas
            </div>
          </div>
        </div>

        {/* Lista de ajustes detectados */}
        <div className="overflow-hidden rounded-md border bg-card">
          <div className="divide-y">
            <div className="flex items-center justify-between gap-3 bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-4">
              <span>Ajuste detectado</span>
              <span>Impacto en utilidad</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm sm:px-4">
              <div className="min-w-0 flex-1">
                <div>Utilidad reportada</div>
              </div>
              <div className="shrink-0 text-right tabular-nums font-medium">
                {fmtFull(reportedNeta)}
              </div>
            </div>
            {detected.map((a) => {
              const isAdded = a.impactOnUtilityMxn > 0;
              return (
                <div
                  key={a.category}
                  className="flex items-start gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <span
                    className={cn(
                      "w-3 shrink-0 text-center font-mono text-base font-medium",
                      isAdded ? "text-success" : "text-destructive"
                    )}
                    aria-hidden
                  >
                    {isAdded ? "+" : "−"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{a.categoryLabel}</div>
                    <div className="text-[11px] leading-snug text-muted-foreground">
                      {a.reason}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      Cuentas: {a.accountCodes.join(", ")} · monto bruto{" "}
                      {fmt(a.amountMxn)}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "shrink-0 text-right text-sm font-medium tabular-nums",
                      isAdded ? "text-success" : "text-destructive"
                    )}
                  >
                    {isAdded ? "+" : "−"}
                    {fmt(Math.abs(a.impactOnUtilityMxn))}
                  </div>
                </div>
              );
            })}
            <div
              className={cn(
                "flex items-center justify-between gap-3 border-t-2 px-3 py-3 text-sm font-bold sm:px-4",
                normalizedNeta >= 0
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              )}
            >
              <span>= Utilidad normalizada</span>
              <span className="tabular-nums">{fmtFull(normalizedNeta)}</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          La utilidad reportada incluye eventos no recurrentes que distorsionan
          la tendencia operativa real. La normalizada muestra cómo va el negocio
          sin esos efectos. <strong>Nota:</strong> los ajustes year-end (catch-up
          depreciación, inventario) son contables — el cash ya se gastó cuando
          se incurrió, este ejercicio solo separa el efecto en el P&L del mes.
        </p>
      </CardContent>
    </Card>
  );
}

/* Break-even analysis: ventas necesarias para cubrir estructura fija ─ */
function BreakEvenCard({
  ventasReales,
  ventasBreakEven,
  gap,
  cumplimientoPct,
  margenMaterialPct,
  costosFijosFabrica,
  costosFijosAdmin,
  costoPrimo,
  monthsCovered,
}: {
  ventasReales: number;
  ventasBreakEven: number;
  gap: number;
  cumplimientoPct: number;
  margenMaterialPct: number;
  costosFijosFabrica: number;
  costosFijosAdmin: number;
  costoPrimo: number;
  monthsCovered: number;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const tone: "success" | "warning" | "danger" =
    cumplimientoPct >= 100
      ? "success"
      : cumplimientoPct >= 85
        ? "warning"
        : "danger";
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : "text-destructive";
  const bgClass =
    tone === "success"
      ? "bg-success/10 border-success/40"
      : tone === "warning"
        ? "bg-warning/10 border-warning/40"
        : "bg-destructive/10 border-destructive/40";
  const gapLabel = gap >= 0 ? "Superas break-even por" : "Te falta vender";
  const gapAbs = Math.abs(gap);
  const perMonth = monthsCovered > 1 ? monthsCovered : 1;

  const progress = Math.min(Math.max(cumplimientoPct, 0), 150);
  const progressWidth = Math.min(progress / 1.5, 100); // escala 0-150% → 0-100%

  return (
    <Card className={`border ${bgClass}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Punto de equilibrio (break-even)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ventas necesarias para cubrir toda la estructura fija (mano de obra,
          overhead fábrica, depreciación, gastos op) con el margen material
          actual. Solo aplica al período seleccionado.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hero: ventas vs break-even */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Vendiste
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {fmt(ventasReales)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Break-even necesitas
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {fmt(ventasBreakEven)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {gapLabel}
            </div>
            <div
              className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}
            >
              {fmt(gapAbs)}
            </div>
            <div className="text-[11px] text-muted-foreground tabular-nums">
              cumplimiento {cumplimientoPct.toFixed(1)}%
              {monthsCovered > 1
                ? ` · ${fmt(gapAbs / perMonth)}/mes`
                : ""}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Progreso hacia break-even</span>
            <span className="tabular-nums">
              {cumplimientoPct.toFixed(0)}% de 100%
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`absolute left-0 top-0 h-full transition-all ${tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-destructive"}`}
              style={{ width: `${progressWidth}%` }}
            />
            {/* Línea al 100% (break-even marker) */}
            <div
              className="absolute top-0 h-full w-px bg-foreground/40"
              style={{ left: `${100 / 1.5}%` }}
              aria-hidden
            />
          </div>
          <div
            className="mt-0.5 flex text-[10px] text-muted-foreground"
            style={{ paddingLeft: `${100 / 1.5}%` }}
          >
            <span>↑ break-even 100%</span>
          </div>
        </div>

        {/* Fórmula visible */}
        <div className="rounded-md border bg-background/60 p-3 text-xs">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Cómo sale este número
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
            <span className="text-muted-foreground">MOD + overhead fábrica + dep</span>
            <span className="text-right">{fmt(costosFijosFabrica)}</span>
            <span className="text-muted-foreground">Gastos op (admin/ventas)</span>
            <span className="text-right">{fmt(costosFijosAdmin)}</span>
            <span className="font-medium">= Costos fijos totales</span>
            <span className="text-right font-medium">
              {fmt(costosFijosFabrica + costosFijosAdmin)}
            </span>
            <span className="text-muted-foreground">÷ Margen material</span>
            <span className="text-right">{margenMaterialPct.toFixed(1)}%</span>
            <span className="font-semibold">= Ventas break-even</span>
            <span className="text-right font-semibold">
              {fmtFull(ventasBreakEven)}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            El margen material ({margenMaterialPct.toFixed(1)}%) viene del
            costo primo recursivo ({fmt(costoPrimo)} sobre {fmt(ventasReales)}).
            Cada peso vendido deja ~{margenMaterialPct.toFixed(0)} centavos para
            cubrir estructura. Con {fmt(costosFijosFabrica + costosFijosAdmin)}
            {" "}de estructura, necesitas vender{" "}
            <span className="font-mono">
              {fmt(costosFijosFabrica + costosFijosAdmin)} ÷{" "}
              {(margenMaterialPct / 100).toFixed(2)} = {fmt(ventasBreakEven)}
            </span>
            .
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PnlLimpioTable({
  ventas,
  costoPrimo,
  cogs501_01Actual,
  mod,
  compras,
  overhead,
  depFabrica,
  gastosOp,
  otros,
  netaContable,
}: {
  ventas: number;
  costoPrimo: number;
  cogs501_01Actual: number;
  mod: number;
  compras: number;
  overhead: number;
  depFabrica: number;
  gastosOp: number;
  otros: number;
  netaContable: number;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const pct = (num: number, den: number) =>
    den > 0 ? `${((num / den) * 100).toFixed(1)}%` : "—";

  // 501.01 residual = lo que tiene 501.01 y NO es MP (CAPA pendiente o exceso)
  // Si positivo: falta CAPA. Si negativo: te pasaste.
  const residual501_01 = cogs501_01Actual - costoPrimo;

  const margenContributivo = ventas - costoPrimo;
  const ebit = margenContributivo - mod - compras - overhead - depFabrica - gastosOp;
  const neta = ebit + otros;

  // Diferencia vs neta contable (debe ser exactamente el residual).
  const deltaNeta = neta - netaContable;

  type Row = {
    label: string;
    amount: number;
    total?: boolean;
    subtotal?: boolean;
    note?: string;
    muted?: boolean;
  };
  const rows: Row[] = [
    { label: "Ventas de producto (4xx)", amount: ventas, total: true },
    { label: "− Costo primo real (BOM recursiva → MP)", amount: -costoPrimo },
    {
      label: "= Margen contributivo material",
      amount: margenContributivo,
      subtotal: true,
      note: `${pct(margenContributivo, ventas)} del ingreso. Cada peso vendido deja esto para cubrir MOD, overhead y gastos.`,
    },
    { label: "− Mano de obra directa (501.06)", amount: -mod },
    { label: "− Compras de importación (502)", amount: -compras },
    { label: "− Overhead fábrica (504.01 renta/energía/servicios)", amount: -overhead },
    { label: "− Depreciación fábrica (504.08-23)", amount: -depFabrica },
    { label: "− Gastos operativos (6xx + 613 dep.)", amount: -gastosOp },
    { label: "= EBIT", amount: ebit, subtotal: true, note: pct(ebit, ventas) },
    { label: "+ Otros ingresos (7xx: FX, intereses, venta activo)", amount: otros },
    { label: "= UTILIDAD NETA (P&L limpio)", amount: neta, total: true },
  ];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[70%]">Concepto</TableHead>
          <TableHead className="text-right">Monto</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow
            key={i}
            className={
              r.total
                ? "font-semibold bg-muted/60"
                : r.subtotal
                  ? "font-medium bg-muted/30"
                  : ""
            }
          >
            <TableCell>
              {r.label}
              {r.note && (
                <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                  {r.note}
                </p>
              )}
            </TableCell>
            <TableCell
              className={`text-right tabular-nums ${r.amount < 0 && !r.total && !r.subtotal ? "text-muted-foreground" : ""}`}
            >
              {fmt(r.amount)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2 bg-warning/5">
          <TableCell>
            <span className="text-xs font-medium">
              Δ vs P&L contable
            </span>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              501.01 contable actual = {fmt(cogs501_01Actual)}, MP real = {fmt(costoPrimo)}.
              Residual de {fmt(residual501_01)} es {residual501_01 > 0
                ? "CAPA pendiente que te falta remover"
                : "CAPA en exceso (removiste de más)"}.
              Neta contable: {fmt(netaContable)} · Neta limpia: {fmt(neta)}.
            </p>
          </TableCell>
          <TableCell className="text-right tabular-nums text-xs">
            <span
              className={
                Math.abs(deltaNeta) < 1
                  ? "text-muted-foreground"
                  : deltaNeta > 0
                    ? "text-success"
                    : "text-destructive"
              }
            >
              {deltaNeta > 0 ? "+" : ""}
              {fmt(deltaNeta)}
            </span>
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
    <>
      {/* Desktop: tabla tradicional con scroll horizontal si aprieta */}
      <div className="-mx-4 hidden overflow-x-auto px-4 md:block">
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
              <TableHead className="text-right">M. cont.</TableHead>
              <TableHead className="text-right">M. MP</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.period}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {p.period}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fmt(p.revenueProductMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                  {fmt(p.revenueInvoicesMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fmt(p.cogsContableMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                  {p.cogsCapaValoracionMxn > 0
                    ? fmt(p.cogsCapaValoracionMxn)
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fmt(p.cogsRecursiveMpMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fmt(p.overheadMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {pct(p.marginContablePct)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {pct(p.marginRecursivePct)}
                </TableCell>
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

      {/* Mobile: cards verticales, una por mes */}
      <div className="space-y-2 md:hidden">
        {points.map((p) => (
          <div
            key={p.period}
            className="rounded-md border bg-background p-3 text-xs"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-sm font-medium">{p.period}</span>
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
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
              <span className="text-muted-foreground">Ventas 4xx</span>
              <span className="text-right font-medium">
                {fmt(p.revenueProductMxn)}
              </span>
              <span className="text-muted-foreground">COGS cont.</span>
              <span className="text-right">{fmt(p.cogsContableMxn)}</span>
              <span className="text-muted-foreground">Capa</span>
              <span className="text-right text-muted-foreground">
                {p.cogsCapaValoracionMxn > 0
                  ? fmt(p.cogsCapaValoracionMxn)
                  : "—"}
              </span>
              <span className="text-muted-foreground">COGS MP (BOM)</span>
              <span className="text-right">{fmt(p.cogsRecursiveMpMxn)}</span>
              <span className="text-muted-foreground">Overhead</span>
              <span className="text-right">{fmt(p.overheadMxn)}</span>
              <span className="text-muted-foreground">Margen contable</span>
              <span className="text-right">{pct(p.marginContablePct)}</span>
              <span className="text-muted-foreground">Margen MP</span>
              <span className="text-right font-medium">
                {pct(p.marginRecursivePct)}
              </span>
            </div>
            {p.note && (
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                {p.note}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
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
    <>
      {/* Desktop: tabla horizontal */}
      <div className="-mx-4 hidden overflow-x-auto px-4 md:block">
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
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {r.productRef ?? (
                    <span className="text-muted-foreground italic">sin ref</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                  {r.productName ?? ""}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {r.qtySold.toLocaleString("es-MX", {
                    maximumFractionDigits: 1,
                  })}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fmt(r.revenueInvoiceMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fmt(r.cogsRecursiveTotalMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
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

      {/* Mobile: cards por producto */}
      <div className="space-y-2 md:hidden">
        {sorted.map((r) => (
          <div
            key={r.productId}
            className="rounded-md border bg-background p-3 text-xs"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-sm font-medium">
                {r.productRef ?? (
                  <span className="italic text-muted-foreground">sin ref</span>
                )}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {r.productName ?? ""}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
              <span className="text-muted-foreground">Qty</span>
              <span className="text-right">
                {r.qtySold.toLocaleString("es-MX", {
                  maximumFractionDigits: 1,
                })}
              </span>
              <span className="text-muted-foreground">Ingreso</span>
              <span className="text-right font-medium">
                {fmt(r.revenueInvoiceMxn)}
              </span>
              <span className="text-muted-foreground">COGS MP</span>
              <span className="text-right">
                {fmt(r.cogsRecursiveTotalMxn)}
              </span>
              <span className="text-muted-foreground">Margen</span>
              <span className="text-right font-medium">
                {r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}
              </span>
            </div>
            {r.flags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {r.flags.map((f) => (
                  <Badge
                    key={f}
                    variant="outline"
                    className="border-warning/40 bg-warning/10 text-[10px] text-warning"
                  >
                    {f.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── F-MP-Q: Calidad de costo primo y composición por producto ──────── */
async function MpQualityBlock({ range }: { range: HistoryRange }) {
  const [mp, top] = await Promise.all([
    getMpLeavesInventory(),
    getTopProductsWithComposition(range, 20),
  ]);

  const flagTone = (flag: string): "success" | "warning" | "danger" | "info" => {
    if (flag === "ok") return "success";
    if (flag === "sin_avg_cost" || flag === "desvio_25pct_vs_ultima") return "danger";
    if (flag === "compra_vieja_6m" || flag === "sin_compra_historica") return "warning";
    return "info";
  };

  const pctOk =
    mp.totalLeaves > 0
      ? Math.round(((mp.flagCounts["ok"] ?? 0) / mp.totalLeaves) * 100)
      : 0;
  const pctSinCosto =
    mp.totalLeaves > 0
      ? Math.round(((mp.flagCounts["sin_avg_cost"] ?? 0) / mp.totalLeaves) * 100)
      : 0;

  // Sort MP leaves by priority: flagged first, then by use frequency
  const priorityFlags = new Set([
    "sin_avg_cost",
    "desvio_25pct_vs_ultima",
    "compra_vieja_6m",
    "sin_compra_historica",
  ]);
  const mpSorted = [...mp.rows].sort((a, b) => {
    const aFlagged = priorityFlags.has(a.flag) ? 0 : 1;
    const bFlagged = priorityFlags.has(b.flag) ? 0 : 1;
    if (aFlagged !== bFlagged) return aFlagged - bFlagged;
    return b.timesUsedInBoms - a.timesUsedInBoms;
  });

  return (
    <QuestionSection
      id="mp-quality"
      question="¿Los costos de mi materia prima están correctos?"
      subtext={`${mp.totalLeaves} MP únicas · ${pctOk}% OK · ${pctSinCosto}% sin avg_cost · top ${top.rows.length} productos vendidos con desglose · ${top.periodLabel}`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="MP con avg_cost OK"
          value={mp.flagCounts["ok"] ?? 0}
          format="number"
          icon={Scale}
          source="canonical"
          tone="success"
          subtitle={`${pctOk}% de ${mp.totalLeaves} · compra reciente + costo consistente`}
        />
        <KpiCard
          title="MP sin avg_cost"
          value={mp.flagCounts["sin_avg_cost"] ?? 0}
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone={pctSinCosto > 20 ? "danger" : "warning"}
          subtitle={`${pctSinCosto}% — cero contribución en BOM recursiva`}
        />
        <KpiCard
          title="MP con compra vieja >6m"
          value={mp.flagCounts["compra_vieja_6m"] ?? 0}
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone="warning"
          subtitle="avg_cost puede estar desactualizado"
        />
        <KpiCard
          title="MP sin compra histórica"
          value={mp.flagCounts["sin_compra_historica"] ?? 0}
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone="warning"
          subtitle="nunca comprada vía PO (insumo indirecto o gap de sync)"
        />
      </StatGrid>

      <Accordion
        type="multiple"
        defaultValue={["top-products"]}
        className="rounded-lg border bg-card"
      >
        <AccordionItem value="top-products">
          <AccordionTrigger className="px-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              Top {top.rows.length} productos vendidos — desglose de costo primo
              <Badge variant="outline" className="text-[11px]">
                click para expandir cada producto
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <TopProductsCompositionTable rows={top.rows} />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="mp-inventory">
          <AccordionTrigger className="px-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              Inventario de MP — {mp.totalLeaves} hojas
              {(mp.flagCounts["sin_avg_cost"] ?? 0) > 0 && (
                <Badge
                  variant="outline"
                  className="border-destructive/40 bg-destructive/10 text-destructive"
                >
                  {mp.flagCounts["sin_avg_cost"]} sin avg_cost
                </Badge>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <MpInventoryTable rows={mpSorted} flagTone={flagTone} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </QuestionSection>
  );
}

/* Tabla top productos con composición (expandible por fila) ─────────── */
function TopProductsCompositionTable({
  rows,
}: {
  rows: TopProductWithComposition[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin productos vendidos en el período.
      </p>
    );
  }
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });

  return (
    <div className="space-y-1">
      {rows.map((r, i) => {
        const marginTone =
          r.marginPct == null
            ? "text-muted-foreground"
            : r.marginPct < 0
              ? "text-destructive"
              : r.marginPct < 50
                ? "text-warning"
                : "text-success";
        const topLeaves = [...r.composition]
          .sort((a, b) => b.costContributionMxn - a.costContributionMxn)
          .slice(0, 20);
        const qtyFmt = r.qtySold.toLocaleString("es-MX", {
          maximumFractionDigits: 0,
        });
        return (
          <details
            key={r.productId}
            className="group rounded-md border bg-background"
          >
            <summary className="flex cursor-pointer flex-col gap-2 px-3 py-2 text-xs hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              {/* Identity row — always visible */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  #{i + 1}
                </span>
                <span className="shrink-0 font-mono font-medium">
                  {r.productRef ?? "sin_ref"}
                </span>
                <span className="truncate text-muted-foreground">
                  {r.productName}
                </span>
              </div>
              {/* Metrics — grid on mobile, inline on desktop */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular-nums sm:flex sm:shrink-0 sm:items-center sm:gap-4 sm:text-xs">
                <div className="flex items-baseline gap-1 sm:block">
                  <span className="text-muted-foreground sm:hidden">Qty</span>
                  <span className="text-muted-foreground">{qtyFmt}</span>
                </div>
                <div className="flex items-baseline gap-1 sm:block">
                  <span className="text-muted-foreground sm:hidden">
                    Ventas
                  </span>
                  <span className="font-medium">
                    {fmt(r.revenueInvoiceMxn)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 sm:block">
                  <span className="text-muted-foreground sm:hidden">COGS</span>
                  <span className="text-muted-foreground">
                    − {fmt(r.cogsRecursiveTotalMxn)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 sm:block">
                  <span className="text-muted-foreground sm:hidden">
                    Margen
                  </span>
                  <span className={`font-medium ${marginTone}`}>
                    {r.marginPct == null
                      ? "—"
                      : `${r.marginPct.toFixed(1)}%`}
                  </span>
                </div>
                {r.leavesWithoutCostInBom > 0 && (
                  <Badge
                    variant="outline"
                    className="col-span-2 w-fit border-warning/40 bg-warning/10 text-[10px] text-warning sm:col-span-1"
                  >
                    {r.leavesWithoutCostInBom} sin costo
                  </Badge>
                )}
              </div>
            </summary>
            <div className="border-t bg-muted/10 px-3 py-2 text-xs">
              <div className="mb-2 text-[11px] text-muted-foreground">
                Costo primo unitario ≈{" "}
                <span className="font-mono font-medium">
                  ${r.cogsRecursiveUnitMxn.toFixed(2)}
                </span>{" "}
                · {r.composition.length} hojas
              </div>
              <div className="-mx-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">d</TableHead>
                      <TableHead>Hoja (MP)</TableHead>
                      <TableHead className="text-right">qty/u</TableHead>
                      <TableHead className="text-right">$/unidad</TableHead>
                      <TableHead className="text-right">Contrib.</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topLeaves.map((l) => (
                      <TableRow key={l.leafProductId}>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {l.depth}
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-[11px]">
                            {l.leafRef ?? "sin_ref"}
                          </div>
                          {l.leafName && (
                            <div className="text-[11px] text-muted-foreground">
                              {l.leafName}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {l.qtyPerUnit.toFixed(5)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {l.avgCostMxn != null && l.avgCostMxn > 0 ? (
                            `$${l.avgCostMxn.toFixed(2)}`
                          ) : (
                            <span className="text-destructive">n/d</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          ${l.costContributionMxn.toFixed(2)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                          {l.pctOfTotal.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/* Tabla inventario de MP (hojas) ─────────────────────────────────────── */
function MpInventoryTable({
  rows,
  flagTone,
}: {
  rows: MpLeafRow[];
  flagTone: (f: string) => "success" | "warning" | "danger" | "info";
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Sin datos de MP.</p>
    );
  }
  const getToneClass = (flag: string) => {
    const tone = flagTone(flag);
    return tone === "danger"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10 text-warning"
        : tone === "success"
          ? "border-success/40 bg-success/10 text-success"
          : "border-muted/40 bg-muted/10 text-muted-foreground";
  };
  return (
    <>
      {/* Desktop: tabla horizontal con scroll */}
      <div className="-mx-4 hidden overflow-x-auto px-4 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="text-right">UoM</TableHead>
              <TableHead className="text-right">avg_cost</TableHead>
              <TableHead className="text-right">Última compra</TableHead>
              <TableHead className="text-right">vs última</TableHead>
              <TableHead className="text-right">BOMs</TableHead>
              <TableHead>Flag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.productId}>
                <TableCell className="whitespace-nowrap font-mono text-[11px]">
                  {r.productRef ?? (
                    <span className="italic text-muted-foreground">sin_ref</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                  {r.productName ?? ""}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-[11px] text-muted-foreground">
                  {r.category ?? ""}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-[11px] text-muted-foreground">
                  {r.uom ?? ""}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {r.avgCostMxn != null && r.avgCostMxn > 0
                    ? `$${r.avgCostMxn.toFixed(2)}`
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-[11px]">
                  {r.lastPurchaseDate ? (
                    <>
                      <span>
                        {r.lastPurchasePrice != null
                          ? `$${r.lastPurchasePrice.toFixed(2)}`
                          : "—"}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {r.daysSincePurchase != null
                          ? `hace ${r.daysSincePurchase}d`
                          : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right tabular-nums text-[11px] ${r.avgCostVsLastPct != null && Math.abs(r.avgCostVsLastPct) > 25 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {r.avgCostVsLastPct != null
                    ? `${r.avgCostVsLastPct > 0 ? "+" : ""}${r.avgCostVsLastPct.toFixed(1)}%`
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-[11px] text-muted-foreground">
                  {r.timesUsedInBoms}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${getToneClass(r.flag)}`}
                  >
                    {r.flag.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards por MP */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div
            key={r.productId}
            className="rounded-md border bg-background p-3 text-xs"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-medium">
                  {r.productRef ?? (
                    <span className="italic text-muted-foreground">sin_ref</span>
                  )}
                </div>
                {r.productName && (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.productName}
                  </div>
                )}
                {r.category && (
                  <div className="truncate text-[10px] text-muted-foreground/70">
                    {r.category}
                  </div>
                )}
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 text-[10px] ${getToneClass(r.flag)}`}
              >
                {r.flag.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
              <span className="text-muted-foreground">avg_cost</span>
              <span className="text-right font-medium">
                {r.avgCostMxn != null && r.avgCostMxn > 0
                  ? `$${r.avgCostMxn.toFixed(2)} / ${r.uom ?? ""}`
                  : "—"}
              </span>
              <span className="text-muted-foreground">Última compra</span>
              <span className="text-right">
                {r.lastPurchaseDate ? (
                  <>
                    {r.lastPurchasePrice != null
                      ? `$${r.lastPurchasePrice.toFixed(2)}`
                      : "—"}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {r.daysSincePurchase != null
                        ? `(${r.daysSincePurchase}d)`
                        : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">nunca</span>
                )}
              </span>
              {r.avgCostVsLastPct != null && (
                <>
                  <span className="text-muted-foreground">Desvío vs última</span>
                  <span
                    className={`text-right ${Math.abs(r.avgCostVsLastPct) > 25 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {r.avgCostVsLastPct > 0 ? "+" : ""}
                    {r.avgCostVsLastPct.toFixed(1)}%
                  </span>
                </>
              )}
              <span className="text-muted-foreground">Uso en BOMs</span>
              <span className="text-right text-muted-foreground">
                {r.timesUsedInBoms}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── F-WTM "¿Dónde está el dinero?" — cash reconciliation ──────────── */
async function CashReconciliationBlock({ range }: { range: HistoryRange }) {
  const data = await getCashReconciliation(range);

  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtSigned = (n: number) => (n >= 0 ? "+" : "") + fmt(n);

  // Ordenar filas por magnitud absoluta del delta (más grande primero)
  const rowsByImpact = [...data.rows]
    .filter((r) => r.category !== "cash")
    .sort((a, b) => Math.abs(b.deltaMxn) - Math.abs(a.deltaMxn));

  // Clasificar como source (cash in) vs use (cash out) del período.
  // Sources (entradas de efectivo):
  //  - Net income (utilidad)
  //  - ΔPasivos positivos (AP sube = no pagaste = source)
  //  - ΔActivos negativos (AR baja = cobraste = source)
  //  - Δequity positivo (aportaciones)
  // Uses (salidas de efectivo):
  //  - ΔActivos positivos (Inv sube, AR sube, CAPEX)
  //  - ΔPasivos negativos (AP baja = pagaste)
  //  - Δequity negativo más allá del net income (retiros)
  type FlowLine = { label: string; amount: number; kind: "source" | "use"; emphasis?: boolean };
  const flows: FlowLine[] = [];

  // Utilidad neta como fuente principal
  flows.push({
    label: "Utilidad neta del período",
    amount: data.netIncomeMxn,
    kind: data.netIncomeMxn >= 0 ? "source" : "use",
    emphasis: true,
  });

  for (const row of rowsByImpact) {
    if (row.category === "equity") {
      // Equity handled separately: retiros = netIncome - Δequity
      if (Math.abs(data.equityWithdrawalsMxn) > 1000) {
        flows.push({
          label:
            data.equityWithdrawalsMxn > 0
              ? "Retiros de capital / dividendos"
              : "Aportaciones de capital",
          amount: Math.abs(data.equityWithdrawalsMxn),
          kind: data.equityWithdrawalsMxn > 0 ? "use" : "source",
          emphasis: Math.abs(data.equityWithdrawalsMxn) > 1_000_000,
        });
      }
      continue;
    }
    if (Math.abs(row.deltaMxn) < 1000) continue; // skip ruido <1k
    const isAsset = row.cashFlowDirection === "use";
    // Si activo sube (+delta) → cash se consumió (use)
    // Si activo baja (−delta) → cash entró (source)
    // Si pasivo sube (+delta) → no pagaste (source)
    // Si pasivo baja (−delta) → pagaste (use)
    const kind: "source" | "use" = isAsset
      ? row.deltaMxn > 0
        ? "use"
        : "source"
      : row.deltaMxn > 0
        ? "source"
        : "use";
    const prefix = isAsset
      ? row.deltaMxn > 0
        ? "Aumento en "
        : "Disminución en "
      : row.deltaMxn > 0
        ? "Aumento en "
        : "Pago de ";
    flows.push({
      label: `${prefix}${row.categoryLabel}`,
      amount: Math.abs(row.deltaMxn),
      kind,
      emphasis: Math.abs(row.deltaMxn) > 3_000_000,
    });
  }

  // Validación de reconciliación
  const sourcesTotal = flows.filter((f) => f.kind === "source").reduce((s, f) => s + f.amount, 0);
  const usesTotal = flows.filter((f) => f.kind === "use").reduce((s, f) => s + f.amount, 0);
  const residualMxn = sourcesTotal - usesTotal - data.deltaCashMxn;

  const cashDropTone: "success" | "warning" | "danger" =
    data.deltaCashMxn >= 0
      ? "success"
      : Math.abs(data.deltaCashMxn) < data.netIncomeMxn * 0.5
        ? "warning"
        : "danger";

  return (
    <QuestionSection
      id="cash-reconciliation"
      question="¿Dónde está el dinero?"
      subtext={`Saldos contables al cierre ${data.fromPeriod} y ${data.toPeriod}.
        El "cash al cierre" puede diferir del efectivo de hoy en el Hero por
        movimientos bancarios posteriores al corte mensual.`}
    >
      {/* Hero de 3 cards: cash inicial → utilidad → cash final */}
      <StatGrid columns={{ mobile: 1, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Saldo contable inicio"
          value={data.openingCashMxn}
          format="currency"
          compact
          icon={Wallet}
          source="canonical"
          tone="default"
          subtitle={`Cierre ${data.fromPeriod}`}
        />
        <KpiCard
          title="Utilidad del período"
          value={data.netIncomeMxn}
          format="currency"
          compact
          icon={TrendingUp}
          source="pl"
          tone={data.netIncomeMxn >= 0 ? "success" : "danger"}
          subtitle="Neta contable (incluye 7xx otros)"
        />
        <KpiCard
          title="Saldo contable cierre"
          value={data.closingCashMxn}
          format="currency"
          compact
          icon={Wallet}
          source="canonical"
          tone="default"
          subtitle={`Cierre ${data.toPeriod} · no es el efectivo de hoy`}
        />
        <KpiCard
          title="Δ Cash vs utilidad"
          value={data.deltaCashMxn - data.netIncomeMxn}
          format="currency"
          compact
          icon={Scale}
          source="pl"
          tone={cashDropTone}
          subtitle={
            data.deltaCashMxn - data.netIncomeMxn < 0
              ? `El cash bajó ${formatCurrencyMXN(data.netIncomeMxn - data.deltaCashMxn, { compact: true })} más que la utilidad`
              : "El cash superó la utilidad"
          }
        />
      </StatGrid>

      {/* Tabla de fuentes y usos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Flujo de efectivo · fuentes vs usos
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Reconciliación: Utilidad +{" "}
            {formatCurrencyMXN(sourcesTotal - data.netIncomeMxn, { compact: true })}{" "}
            de fuentes − {fmt(usesTotal)} de usos = Δcash{" "}
            {fmtSigned(data.deltaCashMxn)}.
            {Math.abs(residualMxn) > 500_000 && (
              <span className="text-warning">
                {" "}Residual {fmtSigned(residualMxn)} — ajustes contables no
                reflejados directamente.
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="divide-y">
            {flows.map((f, i) => {
              const emphasisClass = f.emphasis ? "font-medium" : "";
              const amountClass =
                f.kind === "source" ? "text-success" : "text-destructive";
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${emphasisClass}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${f.kind === "source" ? "bg-success" : "bg-destructive"}`}
                      aria-hidden
                    />
                    <span>{f.label}</span>
                    <Badge
                      variant="outline"
                      className={
                        f.kind === "source"
                          ? "border-success/40 bg-success/10 text-[10px] text-success"
                          : "border-destructive/40 bg-destructive/10 text-[10px] text-destructive"
                      }
                    >
                      {f.kind === "source" ? "+cash" : "−cash"}
                    </Badge>
                  </div>
                  <span className={`tabular-nums ${amountClass}`}>
                    {f.kind === "source" ? "+" : "−"}
                    {fmt(f.amount)}
                  </span>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 bg-muted/50 px-4 py-3 text-sm font-semibold">
              <span>= Δ Cash observado</span>
              <span
                className={`tabular-nums ${data.deltaCashMxn >= 0 ? "text-success" : "text-destructive"}`}
              >
                {fmtSigned(data.deltaCashMxn)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla detallada de balance sheet */}
      <Accordion
        type="multiple"
        defaultValue={[]}
        className="rounded-lg border bg-card"
      >
        <AccordionItem value="bs-detail">
          <AccordionTrigger className="px-4">
            <span className="text-sm font-medium">
              Detalle balance sheet · saldos al corte
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <CashReconciliationTable rows={data.rows} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {data.equityWithdrawalsMxn > 500_000 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="font-medium text-destructive">
            ⚠ Se retiró {fmt(data.equityWithdrawalsMxn)} de capital durante el
            período
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Utilidad del período: {fmt(data.netIncomeMxn)}. Δ Equity contable:{" "}
            {fmt(data.rows.find((r) => r.category === "equity")?.deltaMxn ?? 0)}.
            Si la utilidad fue {fmt(data.netIncomeMxn)} pero equity creció
            menos, la diferencia se fue como retiros/dividendos.
          </p>
        </div>
      )}
    </QuestionSection>
  );
}

function CashReconciliationTable({ rows }: { rows: CashCategoryRow[] }) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtSigned = (n: number) => (n >= 0 ? "+" : "") + fmt(n);
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Categoría</TableHead>
            <TableHead className="text-right">Saldo inicio</TableHead>
            <TableHead className="text-right">Saldo final</TableHead>
            <TableHead className="text-right">Δ del período</TableHead>
            <TableHead>Efecto cash</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isAsset = r.cashFlowDirection === "use";
            const cashEffect =
              Math.abs(r.deltaMxn) < 1000
                ? "—"
                : isAsset
                  ? r.deltaMxn > 0
                    ? "consume cash"
                    : "libera cash"
                  : r.deltaMxn > 0
                    ? "libera cash"
                    : "consume cash";
            const tone = cashEffect === "libera cash" ? "success" : cashEffect === "consume cash" ? "destructive" : "muted-foreground";
            return (
              <TableRow key={r.category}>
                <TableCell className="font-medium">{r.categoryLabel}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                  {fmt(r.openingMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fmt(r.closingMxn)}
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right tabular-nums ${r.deltaMxn >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {fmtSigned(r.deltaMxn)}
                </TableCell>
                <TableCell className="text-xs">
                  <span className={`text-${tone}`}>{cashEffect}</span>
                </TableCell>
              </TableRow>
            );
          })}
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
      collapsible
      defaultOpen={false}
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
      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryStat label="Saldo inicial" value={proj.openingBalance} />
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

      <CashProjectionChart projection={proj} />

      <ProjectionTimeline
        events={proj.events}
        horizonDays={proj.horizonDays}
      />

      <CashCategoryBreakdown
        categoryTotals={proj.categoryTotals}
        horizonDays={proj.horizonDays}
      />

      <CustomerInflowBreakdownTable
        rows={proj.customerInflowBreakdown}
        horizonDays={proj.horizonDays}
      />

      <SensitivityAnalysisBlock projection={proj} />

      <ModelLearningBadge learning={proj.learning} />

      {belowFloor && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
          Saldo mínimo proyectado <Currency amount={proj.minBalance} /> el{" "}
          {proj.minBalanceDate} cruza el piso configurable de{" "}
          <Currency amount={proj.safetyFloor} />.
        </div>
      )}

      {proj.overdueInflowCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant="outline"
            className="border-warning/40 text-warning text-[10px]"
          >
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
    </QuestionSection>
  );
}

/* Desglose de inflows/outflows del cash projection por categoría ───── */
function CashCategoryBreakdown({
  categoryTotals,
  horizonDays,
}: {
  categoryTotals: CashFlowCategoryTotal[];
  horizonDays: number;
}) {
  if (categoryTotals.length === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const inflows = categoryTotals.filter((c) => c.flowType === "inflow");
  const outflows = categoryTotals.filter((c) => c.flowType === "outflow");
  const totalIn = inflows.reduce((s, c) => s + c.amountMxn, 0);
  const totalOut = outflows.reduce((s, c) => s + c.amountMxn, 0);
  const net = totalIn - totalOut;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* Entradas */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Entradas esperadas · {horizonDays}d
        </div>
        <div className="divide-y">
          {inflows.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Sin entradas
            </div>
          ) : (
            inflows.map((c) => {
              const pct = totalIn > 0 ? (c.amountMxn / totalIn) * 100 : 0;
              return (
                <div
                  key={c.category}
                  className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div>{c.categoryLabel}</div>
                    <div
                      className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-success/60"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums text-success">
                      +{fmt(c.amountMxn)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {pct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between gap-3 border-t-2 border-success/30 bg-success/10 px-3 py-2 text-sm font-semibold sm:px-4">
            <span>Total entradas</span>
            <span className="tabular-nums text-success">+{fmt(totalIn)}</span>
          </div>
        </div>
      </div>

      {/* Salidas */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Salidas programadas · {horizonDays}d
        </div>
        <div className="divide-y">
          {outflows.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Sin salidas
            </div>
          ) : (
            outflows.map((c) => {
              const pct = totalOut > 0 ? (c.amountMxn / totalOut) * 100 : 0;
              return (
                <div
                  key={c.category}
                  className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div>{c.categoryLabel}</div>
                    <div
                      className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-destructive/60"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums text-destructive">
                      −{fmt(c.amountMxn)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {pct.toFixed(0)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between gap-3 border-t-2 border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold sm:px-4">
            <span>Total salidas</span>
            <span className="tabular-nums text-destructive">
              −{fmt(totalOut)}
            </span>
          </div>
        </div>
      </div>

      {/* Net del período */}
      <div
        className={cn(
          "rounded-md border px-3 py-2 text-sm md:col-span-2 sm:px-4",
          net >= 0
            ? "border-success/40 bg-success/10"
            : "border-destructive/40 bg-destructive/10"
        )}
      >
        <div className="flex items-center justify-between gap-3 font-semibold">
          <span>Cambio neto en cash · {horizonDays}d</span>
          <span
            className={cn(
              "tabular-nums",
              net >= 0 ? "text-success" : "text-destructive"
            )}
          >
            {net >= 0 ? "+" : ""}
            {fmt(net)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Incluye AR/AP factura por factura + gastos recurrentes
          proyectados desde patrón histórico (nómina día 15 + último,
          renta día 1, servicios día 10, arrendamiento día 5) + cobranza
          proyectada de ventas futuras (ponderada al 85%).
        </p>
      </div>
    </div>
  );
}

/* Top 10 clientes con desglose de inflow esperado por capa ───────────── */
function CustomerInflowBreakdownTable({
  rows,
  horizonDays,
}: {
  rows: CustomerCashflowRow[];
  horizonDays: number;
}) {
  if (rows.length === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const top = rows.slice(0, 10);

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="border-b bg-muted/30 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Top 10 clientes · cobranza esperada · {horizonDays}d
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-success/70" />
              AR (capa 1)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-info/70" />
              SO (capa 2)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-warning/70" />
              Run rate (capa 3)
            </span>
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Saturación = (AR + SO) / run rate × 100. ≥100% = pipeline cubre
          (capa 3 = $0). &lt;100% = gap → capa 3 aporta el residual.
          Cada barra suma al run rate mensual del cliente — los segmentos
          son los 3 buckets weighted, sin duplicar.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px]">Cliente</TableHead>
              <TableHead className="text-right">Run rate/mes</TableHead>
              <TableHead className="min-w-[280px]">Mezcla esperada</TableHead>
              <TableHead className="text-right">Total esperado</TableHead>
              <TableHead className="text-right">Saturación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {top.map((r) => {
              const satTone =
                r.saturationPct == null
                  ? "text-muted-foreground"
                  : r.saturationPct >= 100
                    ? "text-success"
                    : r.saturationPct >= 60
                      ? "text-warning"
                      : "text-destructive";
              // Las 3 barras se dimensionan respecto al run rate esperado
              // del horizonte. Si bucket1+2 superan al run rate, capa 3=0
              // y el total puede exceder 100% (mostrado con cap visual).
              const denom = Math.max(
                r.expectedInHorizonMxn,
                r.bucket1WeightedMxn + r.bucket2WeightedMxn + r.bucket3ExpectedMxn
              );
              const arPct = denom > 0 ? (r.bucket1WeightedMxn / denom) * 100 : 0;
              const soPct = denom > 0 ? (r.bucket2WeightedMxn / denom) * 100 : 0;
              const rrPct = denom > 0 ? (r.bucket3ExpectedMxn / denom) * 100 : 0;
              return (
                <TableRow key={r.customerId}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/empresas/${r.customerId}`}
                      className="hover:underline"
                    >
                      {r.customerName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(r.monthlyAvgMxn)}
                  </TableCell>
                  <TableCell>
                    <div
                      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
                      aria-label={`AR ${fmt(r.bucket1WeightedMxn)}, SO ${fmt(r.bucket2WeightedMxn)}, run rate ${fmt(r.bucket3ExpectedMxn)}`}
                    >
                      <div
                        className="h-full bg-success/70"
                        style={{ width: `${arPct}%` }}
                        title={`AR ya facturado: ${fmt(r.bucket1WeightedMxn)}`}
                      />
                      <div
                        className="h-full bg-info/70"
                        style={{ width: `${soPct}%` }}
                        title={`SO sin factura: ${fmt(r.bucket2WeightedMxn)}`}
                      />
                      <div
                        className="h-full bg-warning/70"
                        style={{ width: `${rrPct}%` }}
                        title={`Run rate residual: ${fmt(r.bucket3ExpectedMxn)}`}
                      />
                    </div>
                    <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                      <span title="AR (capa 1)">{fmt(r.bucket1WeightedMxn)}</span>
                      <span title="SO (capa 2)">
                        {r.bucket2WeightedMxn > 0
                          ? fmt(r.bucket2WeightedMxn)
                          : "—"}
                      </span>
                      <span title="Run rate residual (capa 3)">
                        {r.bucket3ExpectedMxn > 0
                          ? fmt(r.bucket3ExpectedMxn)
                          : "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {fmt(r.totalExpectedMxn)}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${satTone}`}>
                    {r.saturationPct == null
                      ? "—"
                      : `${r.saturationPct.toFixed(0)}%`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* Timeline de eventos: agrupa TODO el detalle por semana, expandible ──── */
/* Sensitivity + Monte Carlo sobre el cash projection ─────────────────── */
function SensitivityAnalysisBlock({ projection }: { projection: CashProjection }) {
  const sens: SensitivitySnapshot = computeSensitivity(projection, 500);
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);

  const top = sens.sensitivity.slice(0, 8);
  const maxAbs = top.reduce(
    (m, r) => Math.max(m, r.absImpactMxn),
    1
  );
  const range = sens.monteCarlo.closingP90Mxn - sens.monteCarlo.closingP10Mxn;
  const rangePct =
    sens.baselineClosingMxn !== 0
      ? (range / Math.abs(sens.baselineClosingMxn)) * 100
      : 0;

  return (
    <details className="overflow-hidden rounded-md border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/40 sm:px-4 [&::-webkit-details-marker]:hidden">
        <span>
          Sensibilidad + Monte Carlo · banda p10-p90
        </span>
        <span className="font-normal normal-case tracking-normal">
          {sens.monteCarlo.iterations.toLocaleString("es-MX")} simulaciones ·
          banda ±{Math.round(rangePct)}% del baseline
        </span>
      </summary>

      <div className="space-y-3 px-3 py-3 sm:px-4">
        {/* Bandas Monte Carlo */}
        <div className="rounded-md border bg-muted/10 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Distribución del closing balance ({sens.horizonDays}d) — 500 escenarios
            con multiplicadores N(1, σ=10-15%) sobre cada componente
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Pesimista (p10)
              </div>
              <div className="text-base font-semibold tabular-nums text-destructive">
                {fmt(sens.monteCarlo.closingP10Mxn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Conservador (p25)
              </div>
              <div className="text-sm font-medium tabular-nums text-warning">
                {fmt(sens.monteCarlo.closingP25Mxn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Mediana (p50)
              </div>
              <div className="text-sm font-medium tabular-nums">
                {fmt(sens.monteCarlo.closingP50Mxn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Probable alto (p75)
              </div>
              <div className="text-sm font-medium tabular-nums text-info">
                {fmt(sens.monteCarlo.closingP75Mxn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Optimista (p90)
              </div>
              <div className="text-base font-semibold tabular-nums text-success">
                {fmt(sens.monteCarlo.closingP90Mxn)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Baseline (modelo punto): {fmt(sens.baselineClosingMxn)}.{" "}
            {sens.monteCarlo.probBelowSafetyFloor > 0 && (
              <span className="text-warning">
                {sens.monteCarlo.probBelowSafetyFloor.toFixed(1)}% probabilidad
                de cruzar el piso de seguridad ({fmt(sens.safetyFloor)}).
              </span>
            )}
            {sens.monteCarlo.probNegativeClosing > 0 && (
              <span className="ml-1 text-destructive">
                {sens.monteCarlo.probNegativeClosing.toFixed(1)}% probabilidad
                de closing negativo.
              </span>
            )}
          </div>
        </div>

        {/* Tornado */}
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            ¿Qué variable mueve más la aguja? (impacto en closing por shock ±10%)
          </div>
          <div className="space-y-1">
            {top.map((r) => {
              const widthPct = (r.absImpactMxn / maxAbs) * 100;
              const isPositive = r.direction === "positive";
              return (
                <div
                  key={r.variable}
                  className="grid items-center gap-2"
                  style={{ gridTemplateColumns: "180px 1fr 100px" }}
                >
                  <div
                    className="text-xs"
                    title={r.description}
                  >
                    {r.label}
                  </div>
                  <div className="relative h-4 rounded-sm bg-muted">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-sm ${isPositive ? "bg-success/60" : "bg-destructive/60"}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <div
                    className={`text-right text-xs tabular-nums ${isPositive ? "text-success" : "text-destructive"}`}
                    title={fmtFull(r.componentMxn)}
                  >
                    {isPositive ? "+" : "−"}
                    {fmt(r.absImpactMxn)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Verde = inflow (su shock +10% sube el closing). Rojo = outflow
            (su shock +10% baja el closing). Las top 3 son donde más impacta
            la incertidumbre — vale la pena monitorear esas más de cerca.
          </div>
        </div>

        <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-info">
            Cómo interpretar la banda
          </span>{" "}
          La proyección punto ({fmt(sens.baselineClosingMxn)}) es solo un
          escenario base. Si los parámetros se desvían dentro de su
          variación histórica típica (±10-15% por categoría), el closing
          real puede caer entre {fmt(sens.monteCarlo.closingP10Mxn)} y{" "}
          {fmt(sens.monteCarlo.closingP90Mxn)} con 80% de probabilidad. La
          banda es ancha cuando hay mucha incertidumbre concentrada en
          pocas variables — el tornado de arriba muestra cuáles.
        </div>
      </div>
    </details>
  );
}

/* Badge mostrando que el modelo aprende del histórico ─────────────────── */
function ModelLearningBadge({
  learning,
}: {
  learning: {
    canonicalSampleSize: number;
    canonicalCounterparties: number;
    satCounterparties: number;
    satOldestRecord: string;
    freshPaymentRate: number;
    freshHeuristicRate: number;
    asOfDate: string;
  };
}) {
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const yearsOfHistory = (() => {
    if (!learning.satOldestRecord) return 0;
    const oldest = new Date(learning.satOldestRecord);
    return Math.max(0, Math.round((Date.now() - oldest.getTime()) / (365 * 86400000)));
  })();
  const calibrationDelta =
    learning.freshPaymentRate - learning.freshHeuristicRate;
  const calibrationLabel =
    calibrationDelta >= 0.01
      ? `+${fmtPct(calibrationDelta)} mejor que heurística`
      : calibrationDelta <= -0.01
        ? `${fmtPct(calibrationDelta)} peor que heurística`
        : "calibrado a heurística";

  return (
    <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-info">
          🧠 Modelo entrenado del histórico
        </span>
        <span>
          <span className="font-medium tabular-nums">
            {learning.canonicalSampleSize.toLocaleString("es-MX")}
          </span>{" "}
          facturas calibradas
        </span>
        <span>·</span>
        <span>
          <span className="font-medium tabular-nums">
            {learning.canonicalCounterparties.toLocaleString("es-MX")}
          </span>{" "}
          contrapartes 12m
        </span>
        <span>·</span>
        <span>
          <span className="font-medium tabular-nums">
            {learning.satCounterparties.toLocaleString("es-MX")}
          </span>{" "}
          en SAT 5y ({yearsOfHistory}y total)
        </span>
        <span>·</span>
        <span>
          Cobro fresh real:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {fmtPct(learning.freshPaymentRate)}
          </span>{" "}
          ({calibrationLabel})
        </span>
      </div>
      <div className="mt-1 leading-snug">
        Probabilidades de recurrencia, delays y trends por contraparte se
        recalculan cada hora desde la última data. Cada nueva factura mejora
        el modelo automáticamente.
      </div>
    </div>
  );
}

/* Timeline de eventos: agrupa TODO el detalle por semana, expandible ──── */
function ProjectionTimeline({
  events,
  horizonDays,
}: {
  events: ProjectionEvent[];
  horizonDays: number;
}) {
  if (events.length === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfWeek = (d: Date): Date => {
    const out = new Date(d);
    const dow = out.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    out.setDate(out.getDate() + diff);
    out.setHours(0, 0, 0, 0);
    return out;
  };
  const todayWeek = startOfWeek(today);
  const fmtDayShort = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString("es-MX", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  };
  const fmtWeekRange = (weekStart: Date): string => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const startTxt = weekStart.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
    });
    const endTxt = end.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
    });
    return `${startTxt} – ${endTxt}`;
  };

  // Agrupa TODOS los eventos por iso de inicio de semana
  const byWeek = new Map<string, ProjectionEvent[]>();
  for (const e of events) {
    const wk = startOfWeek(new Date(e.date));
    const key = wk.toISOString().slice(0, 10);
    const arr = byWeek.get(key) ?? [];
    arr.push(e);
    byWeek.set(key, arr);
  }

  const sortedWeeks = Array.from(byWeek.entries())
    .map(([key, items]) => ({ key, items, weekStart: new Date(key) }))
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .slice(0, 12); // hasta 12 semanas (cubre horizonte 90d)

  if (sortedWeeks.length === 0) return null;

  const weekLabel = (weekStart: Date): string => {
    const diffDays = Math.round(
      (weekStart.getTime() - todayWeek.getTime()) / 86400000
    );
    if (diffDays === 0) return "Esta semana";
    if (diffDays === 7) return "Próxima semana";
    return `Semana del ${fmtWeekRange(weekStart)}`;
  };

  const catTone = (e: ProjectionEvent): string => {
    if (e.kind === "inflow") {
      if (e.category === "ar_cobranza")
        return "bg-success/10 text-success border-success/30";
      if (e.category === "ventas_confirmadas")
        return "bg-info/10 text-info border-info/30";
      if (e.category === "runrate_clientes")
        return "bg-warning/10 text-warning border-warning/30";
      return "bg-success/10 text-success border-success/30";
    }
    if (e.category === "impuestos_sat")
      return "bg-warning/10 text-warning border-warning/30";
    if (e.category === "nomina")
      return "bg-primary/10 text-primary border-primary/30";
    return "bg-destructive/10 text-destructive border-destructive/30";
  };

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
        <span>Calendario de eventos · próximos {horizonDays}d</span>
        <span className="font-normal normal-case tracking-normal">
          {events.length} eventos · click semana para ver detalle
        </span>
      </div>
      <div className="divide-y">
        {sortedWeeks.map(({ key, items, weekStart }, weekIdx) => {
          const totalIn = items
            .filter((e) => e.kind === "inflow")
            .reduce((s, e) => s + e.amountMxn, 0);
          const totalOut = items
            .filter((e) => e.kind === "outflow")
            .reduce((s, e) => s + e.amountMxn, 0);
          const net = totalIn - totalOut;
          const inflowCount = items.filter((e) => e.kind === "inflow").length;
          const outflowCount = items.filter((e) => e.kind === "outflow").length;
          // Default open: las primeras 2 semanas (esta + próxima)
          const defaultOpen = weekIdx < 2;
          // Sort: por monto desc dentro de la semana (más impactante arriba)
          const sortedItems = [...items].sort(
            (a, b) => b.amountMxn - a.amountMxn
          );
          return (
            <details
              key={key}
              open={defaultOpen}
              className="group [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 bg-muted/15 px-3 py-2 text-xs hover:bg-muted/30 sm:px-4">
                <div className="flex items-baseline gap-2">
                  <ChevronRight
                    className="size-3 shrink-0 self-center transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                  <span className="font-semibold">{weekLabel(weekStart)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtWeekRange(weekStart)}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 text-[11px]">
                  <span className="text-success tabular-nums">
                    +{fmt(totalIn)}
                    <span className="ml-0.5 text-[10px] text-muted-foreground">
                      ({inflowCount})
                    </span>
                  </span>
                  <span className="text-destructive tabular-nums">
                    −{fmt(totalOut)}
                    <span className="ml-0.5 text-[10px] text-muted-foreground">
                      ({outflowCount})
                    </span>
                  </span>
                  <span
                    className={cn(
                      "min-w-[80px] text-right font-semibold tabular-nums",
                      net >= 0 ? "text-success" : "text-destructive"
                    )}
                  >
                    Net {net >= 0 ? "+" : ""}
                    {fmt(net)}
                  </span>
                </div>
              </summary>
              <div className="divide-y">
                {sortedItems.map((e, i) => {
                  const counterpartyHref =
                    e.companyId != null ? `/empresas/${e.companyId}` : null;
                  const counterpartyText =
                    e.counterpartyName ?? e.label ?? "—";
                  return (
                    <div
                      key={`${e.date}-${i}`}
                      className="flex items-center gap-3 px-3 py-1.5 text-sm sm:px-4"
                    >
                      <div className="w-[110px] shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {fmtDayShort(e.date)}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                          catTone(e)
                        )}
                      >
                        {e.categoryLabel}
                      </span>
                      <div className="min-w-0 flex-1 truncate text-[12px]">
                        {counterpartyHref ? (
                          <Link
                            href={counterpartyHref}
                            className="hover:underline"
                          >
                            {counterpartyText}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {counterpartyText}
                          </span>
                        )}
                        {e.label && e.counterpartyName && e.label !== e.counterpartyName && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            · {e.label}
                          </span>
                        )}
                        {(e.daysOverdue ?? 0) > 0 && (
                          <span className="ml-1 text-[10px] text-warning">
                            · vencido {e.daysOverdue}d
                          </span>
                        )}
                        {e.probability != null && e.kind === "inflow" && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            · {Math.round(e.probability * 100)}%
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={cn(
                            "text-sm font-medium tabular-nums",
                            e.kind === "inflow"
                              ? "text-success"
                              : "text-destructive"
                          )}
                        >
                          {e.kind === "inflow" ? "+" : "−"}
                          {fmt(e.amountMxn)}
                        </div>
                        {e.kind === "inflow" &&
                          e.nominalAmountMxn > e.amountMxn && (
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              de {fmt(e.nominalAmountMxn)} nominal
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </div>
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
  const total = accounts.reduce(
    (s, a) => s + (a.classification === "cash" ? a.currentBalanceMxn : 0),
    0
  );
  return (
    <QuestionSection
      id="bank-detail"
      question="¿Qué hay en cada cuenta bancaria?"
      subtext={`${accounts.length} cuentas · ${formatCurrencyMXN(total, { compact: true })} en efectivo`}
      collapsible
      defaultOpen={false}
    >
      <BankDetailExpand accounts={accounts} />
    </QuestionSection>
  );
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
          <BalanceSheetTable
            assets={bs.detailRows.filter((r) => r.side === "asset")}
            liabilities={bs.detailRows.filter((r) => r.side === "liability")}
            equity={bs.detailRows.filter((r) => r.side === "equity")}
            totalAssets={bs.totalAssetsMxn}
            totalLiabilities={bs.totalLiabilitiesMxn}
            totalEquity={bs.totalEquityMxn}
            liquidityRatio={bs.liquidityRatio}
            debtToEquityRatio={bs.debtToEquityRatio}
            netIncomeLifetimeMxn={bs.netIncomeLifetimeMxn}
          />
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

/* Tabla balance general estilo estado financiero clásico ──────────── */
function BalanceSheetTable({
  assets,
  liabilities,
  equity,
  totalAssets,
  totalLiabilities,
  totalEquity,
  liquidityRatio,
  debtToEquityRatio,
  netIncomeLifetimeMxn,
}: {
  assets: BalanceSheetCategoryRow[];
  liabilities: BalanceSheetCategoryRow[];
  equity: BalanceSheetCategoryRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  liquidityRatio: number | null;
  debtToEquityRatio: number | null;
  netIncomeLifetimeMxn: number;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n);
  const totalLiabPlusEquity = totalLiabilities + totalEquity;
  const passSign = Math.sign(totalLiabPlusEquity);
  const equityCalc = totalEquity; // ya viene positivo

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Columna izquierda: ACTIVO */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Activo
        </div>
        <div className="divide-y">
          {assets.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Sin desglose disponible
            </div>
          ) : (
            assets.map((r) => {
              const pct =
                totalAssets > 0 ? (r.closingMxn / totalAssets) * 100 : 0;
              return (
                <div
                  key={r.category}
                  className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div>{r.categoryLabel}</div>
                    <div
                      className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-primary/40"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums">
                      {fmt(r.closingMxn)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {pct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between gap-3 border-t-2 border-foreground/20 bg-muted/40 px-3 py-3 text-sm font-semibold sm:px-4">
            <span>TOTAL ACTIVO</span>
            <span className="tabular-nums">{fmt(totalAssets)}</span>
          </div>
        </div>
      </div>

      {/* Columna derecha: PASIVO + CAPITAL */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Pasivo
        </div>
        <div className="divide-y">
          {liabilities.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
              Sin desglose
            </div>
          ) : (
            liabilities.map((r) => {
              const pct =
                totalLiabPlusEquity > 0
                  ? (r.closingMxn / totalLiabPlusEquity) * 100
                  : 0;
              return (
                <div
                  key={r.category}
                  className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div>{r.categoryLabel}</div>
                    <div
                      className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-warning/50"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums">
                      {fmt(r.closingMxn)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {pct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2 text-sm font-medium sm:px-4">
            <span>Total pasivo</span>
            <span className="tabular-nums">{fmt(totalLiabilities)}</span>
          </div>
        </div>

        <div className="border-b border-t-2 border-foreground/20 bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Capital contable
        </div>
        <div className="divide-y">
          {equity.length === 0 ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm sm:px-4">
              <span>Capital total</span>
              <span className="tabular-nums">{fmt(equityCalc)}</span>
            </div>
          ) : (
            equity.map((r) => (
              <div
                key={r.category}
                className="flex items-center gap-3 px-3 py-2 text-sm sm:px-4"
              >
                <span className="flex-1">{r.categoryLabel}</span>
                <span className="tabular-nums">{fmt(r.closingMxn)}</span>
              </div>
            ))
          )}
          <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2 text-sm font-medium sm:px-4">
            <span>Total capital</span>
            <span className="tabular-nums">{fmt(equityCalc)}</span>
          </div>
        </div>

        <div
          className={cn(
            "flex items-center justify-between gap-3 border-t-2 px-3 py-3 text-sm font-semibold sm:px-4",
            passSign >= 0
              ? "border-foreground/20 bg-muted/40"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          )}
        >
          <span>TOTAL PASIVO + CAPITAL</span>
          <span className="tabular-nums">{fmt(totalLiabPlusEquity)}</span>
        </div>
      </div>

      {/* Footer indicators */}
      <div className="lg:col-span-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-md border bg-card px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Liquidez (A/P)</div>
          <div className="mt-0.5 text-base font-semibold tabular-nums">
            {liquidityRatio == null ? "—" : `${liquidityRatio.toFixed(2)}×`}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {liquidityRatio == null
              ? ""
              : liquidityRatio >= 1.5
                ? "saludable"
                : liquidityRatio >= 1
                  ? "ajustado"
                  : "comprometido"}
          </div>
        </div>
        <div className="rounded-md border bg-card px-3 py-2">
          <div className="text-[11px] text-muted-foreground">Apalancamiento (P/C)</div>
          <div className="mt-0.5 text-base font-semibold tabular-nums">
            {debtToEquityRatio == null
              ? "—"
              : `${debtToEquityRatio.toFixed(2)}×`}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {debtToEquityRatio == null
              ? ""
              : debtToEquityRatio < 0.5
                ? "conservador"
                : debtToEquityRatio < 1
                  ? "moderado"
                  : "alto"}
          </div>
        </div>
        <div className="rounded-md border bg-card px-3 py-2 col-span-2 sm:col-span-1">
          <div className="text-[11px] text-muted-foreground">Utilidad acumulada (vida)</div>
          <div className="mt-0.5 text-base font-semibold tabular-nums">
            {fmt(netIncomeLifetimeMxn)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            ya está dentro del capital
          </div>
        </div>
      </div>
    </div>
  );
}

function bucketAccountCount(
  buckets: Array<{ bucket: string; accountsCount: number }>,
  kind: string
): number {
  return buckets.find((b) => b.bucket === kind)?.accountsCount ?? 0;
}

/* ── F-DISC Discrepancias Odoo ↔ SAT ─────────────────────────────────── */
async function InvoiceDiscrepanciesBlock({ range }: { range: HistoryRange }) {
  const disc = await getInvoiceDiscrepancies(range);
  const periodLabel = periodBoundsForRange(range).label;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });

  if (disc.totalCount === 0) {
    return (
      <QuestionSection
        id="discrepancies"
        question="¿Hay diferencias entre Odoo y SAT?"
        subtext={`Cero discrepancias detectadas en ${periodLabel}. Las facturas en Odoo cuadran con los CFDI en SAT.`}
      >
        <EmptyState
          icon={Scale}
          title="Sin discrepancias"
          description="Odoo y SAT están sincronizados al 100%."
        />
      </QuestionSection>
    );
  }

  const apReceived = disc.categories.filter((c) => c.direction === "received");
  const arIssued = disc.categories.filter((c) => c.direction === "issued");
  const criticalCats = disc.categories.filter((c) => c.severity === "critical");

  return (
    <QuestionSection
      id="discrepancies"
      question="¿Hay diferencias entre Odoo y SAT?"
      subtext={`${disc.totalCount} facturas con desfase entre ERP y libro fiscal · ${periodLabel}.
        Lo más común: pagos registrados en SAT (vía complemento) que el equipo
        no marcó como pagados en Odoo.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Facturas con desfase"
          value={disc.totalCount}
          format="number"
          icon={FileX}
          source="canonical"
          tone={disc.totalCount > 50 ? "warning" : "default"}
          subtitle={`${apReceived.reduce((s, c) => s + c.count, 0)} AP · ${arIssued.reduce((s, c) => s + c.count, 0)} AR`}
        />
        <KpiCard
          title="Monto AP afectado"
          value={disc.affectedApMxn}
          format="currency"
          compact
          icon={Receipt}
          source="canonical"
          tone="warning"
          subtitle="proveedores"
        />
        <KpiCard
          title="Monto AR afectado"
          value={disc.affectedArMxn}
          format="currency"
          compact
          icon={Receipt}
          source="canonical"
          tone="warning"
          subtitle="clientes"
        />
        <KpiCard
          title="Críticas"
          value={criticalCats.reduce((s, c) => s + c.count, 0)}
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone={criticalCats.length > 0 ? "danger" : "default"}
          subtitle={
            criticalCats.length > 0
              ? `${fmt(criticalCats.reduce((s, c) => s + c.totalMxn, 0))}`
              : "ninguna"
          }
        />
      </StatGrid>

      <Accordion type="multiple" className="space-y-2">
        {disc.categories.map((cat) => (
          <AccordionItem
            key={`${cat.kind}-${cat.direction}`}
            value={`${cat.kind}-${cat.direction}`}
            className="overflow-hidden rounded-md border bg-card"
          >
            <AccordionTrigger className="px-3 py-2 hover:no-underline sm:px-4">
              <div className="flex flex-1 items-center gap-3 text-left">
                <span
                  className={cn(
                    "inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    cat.direction === "received"
                      ? "bg-warning/10 text-warning border-warning/30"
                      : "bg-primary/10 text-primary border-primary/30"
                  )}
                >
                  {cat.direction === "received" ? "AP" : "AR"}
                </span>
                <span
                  className={cn(
                    "inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                    cat.severity === "critical"
                      ? "bg-destructive/10 text-destructive border-destructive/30"
                      : cat.severity === "warning"
                        ? "bg-warning/10 text-warning border-warning/30"
                        : "bg-muted text-muted-foreground border-muted-foreground/20"
                  )}
                >
                  {cat.severity === "critical"
                    ? "Crítica"
                    : cat.severity === "warning"
                      ? "Atención"
                      : "Info"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{cat.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {cat.count} facturas
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">
                    {fmt(cat.totalMxn)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3 sm:px-4">
              <div className="mb-3 rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs">
                <span className="font-semibold">Acción: </span>
                {cat.recommendedAction}
              </div>
              <DiscrepancyInvoiceTable invoices={cat.topInvoices} kind={cat.kind} />
              {cat.count > cat.topInvoices.length && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  Mostrando top {cat.topInvoices.length} de {cat.count} facturas.
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </QuestionSection>
  );
}

function DiscrepancyInvoiceTable({
  invoices,
  kind,
}: {
  invoices: DiscrepancyInvoice[];
  kind: DiscrepancyCategory["kind"];
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const showResids = kind === "amount_mismatch" || kind === "odoo_open_sat_paid" || kind === "odoo_paid_sat_open";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Factura</TableHead>
          <TableHead>Contraparte</TableHead>
          <TableHead className="text-right">Monto MXN</TableHead>
          {showResids && <TableHead className="text-right">Odoo</TableHead>}
          {showResids && <TableHead className="text-right">SAT</TableHead>}
          <TableHead className="text-right">Días</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((inv) => (
          <TableRow key={inv.canonicalId}>
            <TableCell className="font-mono text-xs">
              {inv.invoiceName ?? inv.canonicalId.slice(0, 24)}
            </TableCell>
            <TableCell className="max-w-[200px] truncate text-xs">
              {inv.partnerName ?? "—"}
            </TableCell>
            <TableCell className="text-right text-sm font-medium tabular-nums">
              {fmt(inv.amountResidualMxn)}
            </TableCell>
            {showResids && (
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {inv.amountResidualOdoo == null
                  ? "—"
                  : inv.amountResidualOdoo.toFixed(0)}
              </TableCell>
            )}
            {showResids && (
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {inv.amountResidualSat == null
                  ? "—"
                  : inv.amountResidualSat.toFixed(0)}
              </TableCell>
            )}
            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
              {inv.daysOpen ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ── F-OBL Obligations summary ───────────────────────────────────────── */
/* ── F-CREDIT — Score crediticio por cliente ──────────────────────────── */
async function CustomerCreditScoresBlock() {
  const data = await getCustomerCreditScores();
  if (data.totalCustomers === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const top = data.rows.slice(0, 25);

  const tierLabel: Record<string, string> = {
    excelente: "Excelente",
    bueno: "Bueno",
    regular: "Regular",
    riesgo: "Riesgo",
    rechazo: "Rechazo",
  };

  return (
    <QuestionSection
      id="credit-score"
      question="¿A qué cliente le presto y cuánto?"
      subtext={`Score de riesgo crediticio (0-100) calculado del histórico
        de pago, recurrencia, volumen, AR vencido y blacklist SAT. Sugiere
        un límite de crédito por cliente. ${data.totalCustomers} clientes
        evaluados. Verde = extender · Rojo = solo prepago.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
        <KpiCard
          title="Excelente (80+)"
          value={data.byTier.excelente}
          format="number"
          tone="success"
          subtitle="Crédito amplio (2× monthly)"
        />
        <KpiCard
          title="Bueno (60-79)"
          value={data.byTier.bueno}
          format="number"
          tone="info"
          subtitle="Crédito normal (1.5×)"
        />
        <KpiCard
          title="Regular (40-59)"
          value={data.byTier.regular}
          format="number"
          tone="warning"
          subtitle="Crédito conservador (1×)"
        />
        <KpiCard
          title="Riesgo (20-39)"
          value={data.byTier.riesgo}
          format="number"
          tone="danger"
          subtitle="Reducir exposición (0.5×)"
        />
        <KpiCard
          title="Rechazo (<20)"
          value={data.byTier.rechazo}
          format="number"
          tone="danger"
          subtitle="Solo prepago"
        />
      </StatGrid>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Top 25 clientes (por monthly avg)
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Cliente</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="text-right">Delay mediano</TableHead>
                <TableHead className="text-right">AR abierto</TableHead>
                <TableHead className="text-right">% vencido</TableHead>
                <TableHead className="text-right">Límite sugerido</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="min-w-[200px]">Recomendación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((r: CustomerCreditScore) => {
                const tone = r.tone;
                const scoreClass =
                  tone === "success"
                    ? "text-success"
                    : tone === "info"
                      ? "text-info"
                      : tone === "warning"
                        ? "text-warning"
                        : tone === "danger"
                          ? "text-destructive"
                          : "text-destructive";
                return (
                  <TableRow key={r.bronzeId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/empresas/${r.bronzeId}`}
                        className="hover:underline"
                      >
                        {r.customerName}
                      </Link>
                      {r.blacklistStatus && (
                        <span className="ml-1 text-[10px] text-destructive">
                          ⚠ {r.blacklistStatus}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${scoreClass}`}
                      title={`Componentes: pago ${r.paymentBehaviorPts}/40, recurrencia ${r.recurrencePts}/25, volumen ${r.volumePts}/15, AR ${r.arStatusPts}/15, trend ${r.trendPts}/5`}
                    >
                      {r.score}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {tierLabel[r.tier]}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(r.monthlyAvgMxn)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.medianDelayDays != null
                        ? `${r.medianDelayDays}d`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.arOpenMxn > 0 ? fmt(r.arOpenMxn) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.arOverduePct > 0
                        ? `${r.arOverduePct.toFixed(0)}%`
                        : "—"}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title={fmtFull(r.recommendedCreditLimitMxn)}
                    >
                      {r.recommendedCreditLimitMxn > 0
                        ? fmt(r.recommendedCreditLimitMxn)
                        : "$0"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${r.availableCreditMxn > 0 ? "text-success" : "text-destructive"}`}
                    >
                      {r.availableCreditMxn > 0
                        ? fmt(r.availableCreditMxn)
                        : "0"}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {r.reason}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-info">Cómo se calcula</span>{" "}
        Score 0-100 combinando: pago histórico (40 pts, mediana de delay
        12m), recurrencia + antigüedad (25 pts, canonical 12m + SAT 60m),
        volumen mensual (15 pts log10), AR vencido actual (15 pts), trend
        (5 pts recent3m/prior9m). Blacklist SAT &apos;definitive&apos; o
        &apos;presumed&apos; → score 0 automático. Límite recomendado =
        monthly_avg × multiplicador del tier (2× excelente → 0.5× riesgo).
        Disponible = límite − AR ya extendido.
      </div>
    </QuestionSection>
  );
}

/* ── F-PRIORITY — Prioridad de pago a proveedores ─────────────────────── */
async function SupplierPriorityBlock() {
  const data = await getSupplierPriorityScores();
  if (data.totalSuppliers === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const top = data.rows.slice(0, 25);

  const tierLabel: Record<string, string> = {
    critico: "CRÍTICO",
    alta: "Alta",
    media: "Media",
    baja: "Baja",
    estirable: "Estirable",
  };

  return (
    <QuestionSection
      id="supplier-priority"
      question="¿A qué proveedor le pago primero cuando no alcanza?"
      subtext={`Score de prioridad (0-100) por proveedor combinando AP
        vencido, dependencia operativa, volumen, antigüedad y categoría
        crítica (SAT/IMSS/Leasing). Más alto = pagar antes. ${data.totalSuppliers}
        proveedores evaluados. Total a pagar HOY (crítico): ${fmt(data.totalCriticoMxn)}.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
        <KpiCard
          title="Crítico (80+)"
          value={data.byTier.critico}
          format="number"
          tone="danger"
          subtitle={`Pagar HOY · ${fmt(data.totalCriticoMxn)}`}
        />
        <KpiCard
          title="Alta (60-79)"
          value={data.byTier.alta}
          format="number"
          tone="warning"
          subtitle={`Esta semana · ${fmt(data.totalAltaMxn)}`}
        />
        <KpiCard
          title="Media (40-59)"
          value={data.byTier.media}
          format="number"
          tone="info"
          subtitle="Próx. 2 semanas"
        />
        <KpiCard
          title="Baja (20-39)"
          value={data.byTier.baja}
          format="number"
          tone="default"
          subtitle="Fin de mes / estirar"
        />
        <KpiCard
          title="Estirable (<20)"
          value={data.byTier.estirable}
          format="number"
          tone="success"
          subtitle="Esperar 30+ días"
        />
      </StatGrid>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Top 25 proveedores ordenados por urgencia de pago
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Proveedor</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">AP abierto</TableHead>
                <TableHead className="text-right">% vencido</TableHead>
                <TableHead className="text-right">Monthly avg</TableHead>
                <TableHead className="text-right">Delay hist</TableHead>
                <TableHead className="min-w-[220px]">Recomendación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((r: SupplierPriorityScore) => {
                const tone = r.tone;
                const scoreClass =
                  tone === "destructive"
                    ? "text-destructive"
                    : tone === "danger"
                      ? "text-destructive"
                      : tone === "warning"
                        ? "text-warning"
                        : tone === "info"
                          ? "text-info"
                          : "text-success";
                return (
                  <TableRow key={r.bronzeId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/empresas/${r.bronzeId}`}
                        className="hover:underline"
                      >
                        {r.supplierName}
                      </Link>
                      {r.isCriticalCategory && (
                        <span className="ml-1 text-[10px] text-warning">
                          ⚠ no negociable
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${scoreClass}`}
                      title={`Componentes: past-due ${r.pastDueSeverityPts}/35, volumen ${r.volumePts}/25, recurrencia ${r.recurrencePts}/20, strict ${r.strictTermsPts}/15, crítico ${r.criticalCategoryPts}/5`}
                    >
                      {r.score}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {tierLabel[r.tier]}
                      </span>
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title={fmtFull(r.apOpenMxn)}
                    >
                      {r.apOpenMxn > 0 ? fmt(r.apOpenMxn) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${r.apOverduePct >= 50 ? "text-destructive" : r.apOverduePct >= 20 ? "text-warning" : ""}`}
                    >
                      {r.apOverduePct > 0
                        ? `${r.apOverduePct.toFixed(0)}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(r.monthlyAvgMxn)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.apDelayHistDays != null
                        ? `${r.apDelayHistDays}d`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {r.recommendedAction}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-info">Cómo se calcula</span>{" "}
        Score 0-100 combinando: past-due severity (35 pts, % AP vencido →
        riesgo de cortar suministro), volumen mensual (25 pts log10),
        recurrencia + antigüedad (20 pts, canonical 12m + SAT 60m), strict
        terms (15 pts — proveedores que cobran a tiempo deben recibir a
        tiempo), categoría crítica (5 pts SAT/IMSS/Leasing/CFE).
        Categorías &quot;no negociables&quot; (multas/intereses si no pagas)
        aparecen marcadas. Espejo del customer credit score: ahí decides a
        quién extender, aquí decides a quién pagar.
      </div>
    </QuestionSection>
  );
}

/* ── F-CCC — Cash Conversion Cycle ────────────────────────────────────── */
async function CashConversionCycleBlock() {
  const ccc = await getCashConversionCycle();
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);

  // Tone helpers
  const cccTone =
    ccc.ccc <= ccc.benchmark.ccc
      ? "success"
      : ccc.ccc <= ccc.benchmark.ccc * 1.3
        ? "warning"
        : "danger";
  const dsoTone =
    ccc.dso <= ccc.benchmark.dso
      ? "success"
      : ccc.dso <= ccc.benchmark.dso * 1.3
        ? "warning"
        : "danger";
  const dioTone =
    ccc.dio <= ccc.benchmark.dio
      ? "success"
      : ccc.dio <= ccc.benchmark.dio * 1.3
        ? "warning"
        : "danger";
  const dpoTone =
    ccc.dpo >= ccc.benchmark.dpo
      ? "success"
      : ccc.dpo >= ccc.benchmark.dpo * 0.7
        ? "warning"
        : "danger";

  // Direction insight
  const recentTrend = ccc.monthlyTrend.slice(-3);
  const trendDelta =
    recentTrend.length >= 2
      ? recentTrend[recentTrend.length - 1].ccc - recentTrend[0].ccc
      : 0;

  return (
    <QuestionSection
      id="ccc"
      question="¿Qué tan rápido regresa mi cash a la operación?"
      subtext={`Cash Conversion Cycle = DSO + DIO − DPO. Mide cuántos
        días pasan entre comprar materia prima y cobrar al cliente.
        Bajo = cash regresa rápido. Alto = capital atorado. Benchmark
        textil mexicano típico: ~105 días. Recálculo cada hora.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="CCC actual"
          value={ccc.ccc}
          format="number"
          tone={cccTone}
          subtitle={`${ccc.ccc > 0 ? "+" : ""}${ccc.ccc} días · benchmark ${ccc.benchmark.ccc}d`}
          icon={Scale}
        />
        <KpiCard
          title="DSO (días cobranza)"
          value={ccc.dso}
          format="number"
          tone={dsoTone}
          subtitle={`AR ${fmt(ccc.arOpenMxn)} / revenue diario · benchmark ${ccc.benchmark.dso}d`}
          icon={ArrowDownCircle}
        />
        <KpiCard
          title="DIO (días inventario)"
          value={ccc.dio}
          format="number"
          tone={dioTone}
          subtitle={`Inv ${fmt(ccc.inventoryMxn)} / cogs diario · benchmark ${ccc.benchmark.dio}d`}
          icon={Receipt}
        />
        <KpiCard
          title="DPO (días pago prov)"
          value={ccc.dpo}
          format="number"
          tone={dpoTone}
          subtitle={`AP ${fmt(ccc.apOpenMxn)} / compras diario · benchmark ${ccc.benchmark.dpo}d`}
          icon={ArrowUpCircle}
        />
      </StatGrid>

      <div className="rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Capital de trabajo atorado en operación
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="text-xl font-semibold tabular-nums text-foreground">
            {fmtFull(ccc.workingCapitalTiedMxn)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            CCC ({ccc.ccc}d) × revenue diario ({fmt(ccc.revenue12mMxn / 365)}/d){" "}
            = cash promedio atorado en el ciclo operativo. Si bajaras CCC en
            10 días, liberarías {fmt((10 * ccc.revenue12mMxn) / 365)} de cash.
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Trend últimos 12 meses{" "}
          {trendDelta !== 0 && (
            <span
              className={`ml-2 font-normal normal-case tracking-normal ${trendDelta < 0 ? "text-success" : "text-destructive"}`}
            >
              {trendDelta < 0 ? "↓" : "↑"} {Math.abs(trendDelta).toFixed(0)}d
              CCC últimos 3 meses
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">DSO</TableHead>
                <TableHead className="text-right">DIO</TableHead>
                <TableHead className="text-right">DPO</TableHead>
                <TableHead className="text-right">CCC</TableHead>
                <TableHead className="text-right">AR</TableHead>
                <TableHead className="text-right">Inventario</TableHead>
                <TableHead className="text-right">AP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ccc.monthlyTrend.map((m) => (
                <TableRow key={m.period}>
                  <TableCell className="font-medium">{m.period}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.dso.toFixed(0)}d</TableCell>
                  <TableCell className="text-right tabular-nums">{m.dio.toFixed(0)}d</TableCell>
                  <TableCell className="text-right tabular-nums">{m.dpo.toFixed(0)}d</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{m.ccc.toFixed(0)}d</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(m.arMxn)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(m.inventoryMxn)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(m.apMxn)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <div className="font-semibold text-info mb-1">
          Cómo leer cada componente
        </div>
        <div className="grid gap-1 leading-snug sm:grid-cols-2">
          <div>
            <span className="font-medium text-foreground">DSO alto:</span> cobras
            tarde. Acción: cobranza dura, factoring, descuento por pronto pago,
            ajustar términos a clientes específicos. (ver score crediticio)
          </div>
          <div>
            <span className="font-medium text-foreground">DIO alto:</span> inventario
            parado. Acción: mejor planning de producción, JIT en MP, vender SKUs
            lentos, reducir compras a recurrentes que ya tienes en bodega.
          </div>
          <div>
            <span className="font-medium text-foreground">DPO bajo:</span> pagas
            muy rápido a proveedores. Acción: negociar términos 30→45→60d,
            estirar pagos hasta el límite contractual sin dañar relación.
          </div>
          <div>
            <span className="font-medium text-foreground">CCC negativo:</span>{" "}
            (raro) cobras antes de pagar — modelo de negocio rentable como Amazon.
            Quimibond opera con CCC positivo (capital atorado).
          </div>
        </div>
      </div>
    </QuestionSection>
  );
}

async function ObligationsBlock() {
  const ob = await getObligationsSummary();
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  // Threshold $1k: el RPC mantiene categorías con remanentes < $1k (típico
  // del ISR retenido cuando el 99% se paga cada mes y deja pesos sueltos)
  // pero account_count y detail vienen vacíos. Mostrarlas confunde al CEO
  // ("hay 54 pesos pero ninguna cuenta"). Filtrar en el render evita tocar
  // la lógica fiscal del RPC.
  const cats = ob.categories.filter((c) => c.outstandingMxn >= 1000);

  const liqLabel =
    ob.liquidityRatio == null
      ? "—"
      : ob.liquidityRatio >= 1.5
        ? "saludable"
        : ob.liquidityRatio >= 1
          ? "ajustado"
          : "comprometido";
  const liqTone =
    ob.liquidityRatio == null
      ? "default"
      : ob.liquidityRatio >= 1.5
        ? "success"
        : ob.liquidityRatio >= 1
          ? "warning"
          : "danger";

  return (
    <QuestionSection
      id="obligations"
      question="¿Cuánto debo y cuándo lo tengo que pagar?"
      subtext={`Saldos al cierre de ${formatPeriod(ob.asOfPeriod)}.
        Operativo excluye intercompañía/préstamos accionistas.
        ≤30d incluye SAT/IMSS día 17. Liquidez = efectivo / obligaciones ≤30d.`}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Operativo (sin intercompañía)"
          value={ob.totalOperativoMxn}
          format="currency"
          compact
          icon={Scale}
          source="canonical"
          tone={ob.totalOperativoMxn > ob.efectivoMxn * 5 ? "danger" : "default"}
          subtitle={`vs ${fmt(ob.efectivoMxn)} en efectivo`}
        />
        <KpiCard
          title="Vencen en ≤30 días"
          value={ob.totalCortoPlazo30Mxn}
          format="currency"
          compact
          icon={CalendarClock}
          source="canonical"
          tone={liqTone as "success" | "warning" | "danger" | "default"}
          subtitle={`liquidez ${ob.liquidityRatio == null ? "—" : `${ob.liquidityRatio.toFixed(2)}× ${liqLabel}`}`}
        />
        <KpiCard
          title="Vencen 30-90 días"
          value={ob.totalCortoPlazo90Mxn - ob.totalCortoPlazo30Mxn}
          format="currency"
          compact
          icon={Receipt}
          source="canonical"
          tone="info"
          subtitle="AP, arrendamiento, préstamos CP"
        />
        <KpiCard
          title="Intercompañía"
          value={ob.totalIntercompaniaMxn}
          format="currency"
          compact
          icon={Building2}
          source="canonical"
          tone="default"
          subtitle="partes relacionadas · no urgente"
        />
      </StatGrid>

      {cats.length === 0 ? (
        <EmptyState
          icon={FileX}
          title="Sin obligaciones registradas"
          description="No hay saldos pendientes en cuentas de pasivo al corte."
        />
      ) : (
        <ObligationsTable
          rows={cats}
          totalMxn={ob.totalMxn}
          fmtFull={fmtFull}
        />
      )}
    </QuestionSection>
  );
}

function ObligationsTable({
  rows,
  totalMxn,
  fmtFull,
}: {
  rows: ObligationCategory[];
  totalMxn: number;
  fmtFull: (n: number) => string;
}) {
  const horizonLabel = (h: ObligationCategory["paymentHorizon"]) => {
    switch (h) {
      case "inmediato":
        return "Inmediato";
      case "30d_sat":
        return "≤30 días (SAT)";
      case "30_60d":
        return "30-60 días";
      case "mensual":
        return "Mensual";
      case "meses":
        return "Próximos meses";
      case "lp":
        return "Largo plazo";
      case "intercompania":
        return "Intercompañía";
    }
  };
  const horizonTone = (h: ObligationCategory["paymentHorizon"]) => {
    switch (h) {
      case "inmediato":
        return "bg-destructive/10 text-destructive border-destructive/30";
      case "30d_sat":
        return "bg-warning/10 text-warning border-warning/30";
      case "30_60d":
      case "mensual":
        return "bg-primary/10 text-primary border-primary/30";
      case "meses":
        return "bg-muted text-muted-foreground border-muted-foreground/20";
      case "lp":
        return "bg-muted/50 text-muted-foreground border-muted-foreground/10";
      case "intercompania":
        return "bg-muted/30 text-muted-foreground border-muted-foreground/10 italic";
    }
  };

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[55%]">Categoría</TableHead>
            <TableHead className="text-center">Vencimiento</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
            <TableHead className="text-right w-[60px]">% del total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const pct = totalMxn > 0 ? (r.outstandingMxn / totalMxn) * 100 : 0;
            const hasDetail = r.detail.length > 1;
            return (
              <TableRow key={r.category}>
                <TableCell>
                  <div className="font-medium">{r.categoryLabel}</div>
                  <div
                    className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-warning/50"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  {hasDetail && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.detail.slice(0, 3).map((d, i) => (
                        <span key={d.accountCode}>
                          {i > 0 && " · "}
                          {d.accountName}
                          {": "}
                          <span className="tabular-nums">
                            {fmtFull(d.outstandingMxn)}
                          </span>
                        </span>
                      ))}
                      {r.detail.length > 3 &&
                        ` · +${r.detail.length - 3} más`}
                    </div>
                  )}
                  {!hasDetail && r.detail[0] && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.detail[0].accountCode} · {r.detail[0].accountName}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      horizonTone(r.paymentHorizon)
                    )}
                  >
                    {horizonLabel(r.paymentHorizon)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtFull(r.outstandingMxn)}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                  {pct.toFixed(1)}%
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="border-t-2 bg-muted/40 font-semibold">
            <TableCell>TOTAL OBLIGACIONES</TableCell>
            <TableCell />
            <TableCell className="text-right tabular-nums">
              {fmtFull(totalMxn)}
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">
              100%
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
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
      collapsible
      defaultOpen={false}
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
      collapsible
      defaultOpen={false}
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
      collapsible
      defaultOpen={false}
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

