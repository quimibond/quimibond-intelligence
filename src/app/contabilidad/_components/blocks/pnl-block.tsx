import { FileX, Flame, Globe2, Receipt, Scale, TrendingDown, TrendingUp } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
  EmptyState,
} from "@/components/patterns";
import type { HistoryRange } from "@/components/patterns/history-range";
import {
  getPnlKpis,
  getCogsComparison,
  getCogsMonthly,
  getCogsPerProduct,
  getPnlNormalized,
  getInventoryAdjustments,
  type CogsMonthlyPoint,
  type CogsPerProductRow,
  type PnlAdjustment,
  type InventoryAdjustmentsSummary,
} from "@/lib/queries/sp13/finanzas";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/* ── F3 P&L — contable vs ajustado a materia prima ───────────────────── */
export async function PnlBlock({ range }: { range: HistoryRange }) {
  const [kpis, cogs, monthly, perProduct, normalized, inventoryAdj] =
    await Promise.all([
      getPnlKpis(range),
      getCogsComparison(range),
      getCogsMonthly(range),
      getCogsPerProduct(range),
      getPnlNormalized(range),
      getInventoryAdjustments(range),
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
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                P&L contable vs limpio · comparación
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Una tabla, dos modelos. El contable usa 501.01 con CAPA
                inflada (Odoo). El limpio reemplaza 501.01 por el costo
                primo real (BOM recursiva hasta materia prima). Los demás
                costos quedan idénticos en ambos. La columna Δ muestra
                exactamente dónde se concentra la duplicación contable.
              </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <PnlComparisonTable
                ventas={kpis.ingresosPl}
                cogs501_01Actual={kpis.cogs501_01Mxn}
                costoPrimo={cogs.cogsRecursiveMpMxn}
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
            inventoryAdj={inventoryAdj}
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
export function PnlNormalizedCard({
  reportedNeta,
  normalizedNeta,
  totalImpact,
  adjustments,
  ventas,
  inventoryAdj,
}: {
  reportedNeta: number;
  normalizedNeta: number;
  totalImpact: number;
  adjustments: PnlAdjustment[];
  ventas: number;
  inventoryAdj?: InventoryAdjustmentsSummary;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const detected = adjustments.filter((a) => a.detected);
  const hasInventoryAdj =
    !!inventoryAdj &&
    detected.some((a) => a.category === "ajuste_inventario_year_end");

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

        {hasInventoryAdj && inventoryAdj && (
          <InventoryAdjustmentsDrilldown summary={inventoryAdj} />
        )}
      </CardContent>
    </Card>
  );
}

/* Drilldown del residual inventario via canonical_stock_moves ─────────── */
function InventoryAdjustmentsDrilldown({
  summary,
}: {
  summary: InventoryAdjustmentsSummary;
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);

  // Agregamos por categoría sumando todos los meses del rango
  const byCategoryMap = new Map<
    string,
    {
      label: string;
      moves: number;
      products: Set<string>;
      qty: number;
      value: number;
    }
  >();
  let totalAdjustment = 0;
  for (const r of summary.rows) {
    const ex = byCategoryMap.get(r.category) ?? {
      label: r.categoryLabel,
      moves: 0,
      products: new Set<string>(),
      qty: 0,
      value: 0,
    };
    ex.moves += r.movesCount;
    // distinct products union via fake set keyed por period+count (proxy)
    ex.qty += r.qtyTotal;
    ex.value += r.valueTotalMxn;
    byCategoryMap.set(r.category, ex);
    if (r.category === "ajuste_inventario") totalAdjustment += r.valueTotalMxn;
  }
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([cat, v]) => ({
      category: cat,
      label: v.label,
      moves: v.moves,
      qty: v.qty,
      value: v.value,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  if (byCategory.length === 0) return null;

  return (
    <details className="rounded-md border bg-muted/20">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium hover:bg-muted/40 sm:px-4">
        <span>
          Drilldown: stock moves por categoría · {summary.periodLabel}
        </span>
        <span className="ml-2 text-muted-foreground">
          (ajuste_inventario total {fmt(totalAdjustment)})
        </span>
      </summary>
      <div className="border-t px-3 py-3 sm:px-4">
        <p className="mb-2 text-[11px] text-muted-foreground">
          Decomposición de movimientos en <code>canonical_stock_moves</code>{" "}
          por categoría derivada del par <code>location_usage</code>. El residual
          year-end típicamente vive en{" "}
          <code className="rounded bg-muted px-1">ajuste_inventario</code>{" "}
          (movimientos <em>inventory ↔ internal</em>: conteos físicos, reclas
          de cuentas, mermas reconocidas).
          {summary.hottestPeriod && (
            <>
              {" "}
              Mes con mayor ajuste:{" "}
              <strong>{summary.hottestPeriod.period}</strong> ·{" "}
              {fmtFull(summary.hottestPeriod.valueMxn)}.
            </>
          )}
        </p>
        <div className="overflow-hidden rounded-md border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">Categoría</th>
                <th className="px-2 py-1.5 text-right tabular-nums">Moves</th>
                <th className="px-2 py-1.5 text-right tabular-nums">Qty</th>
                <th className="px-2 py-1.5 text-right tabular-nums">Valor MXN</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {byCategory.map((r) => (
                <tr
                  key={r.category}
                  className={cn(
                    r.category === "ajuste_inventario" && "bg-warning/5"
                  )}
                >
                  <td className="px-2 py-1.5 font-medium">
                    {r.label}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.moves.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {Math.abs(r.qty) >= 1000
                      ? `${(r.qty / 1000).toFixed(1)}k`
                      : r.qty.toFixed(0)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right tabular-nums",
                      r.value >= 0 ? "text-foreground" : "text-destructive"
                    )}
                  >
                    {fmtFull(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Source:{" "}
          <code>get_inventory_adjustments(p_from, p_to)</code> sobre{" "}
          <code>canonical_stock_moves</code> (1.6M rows promovidos del bronze
          en migration 20260427_canonical_stock_moves.sql).
        </p>
      </div>
    </details>
  );
}

/* Break-even analysis: ventas necesarias para cubrir estructura fija ─ */
export function BreakEvenCard({
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

/* P&L contable vs limpio — tabla comparativa unificada ──────────────── */
export function PnlComparisonTable({
  ventas,
  cogs501_01Actual,
  costoPrimo,
  mod,
  compras,
  overhead,
  depFabrica,
  gastosOp,
  otros,
  netaContable,
}: {
  ventas: number;
  cogs501_01Actual: number;
  costoPrimo: number;
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

  // Totales por columna. costoVentas = COGS + MOD + Compras + Overhead + Dep
  const costoVentasContable =
    cogs501_01Actual + mod + compras + overhead + depFabrica;
  const costoVentasLimpio = costoPrimo + mod + compras + overhead + depFabrica;
  const utilBrutaContable = ventas - costoVentasContable;
  const utilBrutaLimpio = ventas - costoVentasLimpio;
  const ebitContable = utilBrutaContable - gastosOp;
  const ebitLimpio = utilBrutaLimpio - gastosOp;
  const netaLimpio = ebitLimpio + otros;
  const residual501_01 = cogs501_01Actual - costoPrimo;
  const deltaNeta = netaLimpio - netaContable;

  type Row = {
    label: string;
    contable: number | null;
    limpio: number | null;
    isSubtotal?: boolean;
    isTotal?: boolean;
    isHeader?: boolean;
    isDetail?: boolean;
    note?: string;
  };

  const rows: Row[] = [
    { label: "Ventas de producto (4xx)", contable: ventas, limpio: ventas, isTotal: true },
    { label: "Costo de ventas:", contable: null, limpio: null, isHeader: true },
    {
      label: "501.01 contable (con CAPA inflada de Odoo)",
      contable: cogs501_01Actual,
      limpio: null,
      isDetail: true,
    },
    {
      label: "Costo primo BOM (MP real, recursivo)",
      contable: null,
      limpio: costoPrimo,
      isDetail: true,
    },
    {
      label: "Mano de obra directa (501.06)",
      contable: mod, limpio: mod, isDetail: true,
    },
    {
      label: "Compras de importación (502)",
      contable: compras, limpio: compras, isDetail: true,
    },
    {
      label: "Overhead fábrica (504.01 renta/energía/mtto)",
      contable: overhead, limpio: overhead, isDetail: true,
    },
    {
      label: "Depreciación fábrica (504.08-23)",
      contable: depFabrica, limpio: depFabrica, isDetail: true,
    },
    {
      label: "Total costo de ventas",
      contable: costoVentasContable, limpio: costoVentasLimpio, isSubtotal: true,
    },
    {
      label: "= Utilidad bruta",
      contable: utilBrutaContable, limpio: utilBrutaLimpio, isSubtotal: true,
      note: `${pct(utilBrutaLimpio, ventas)} sobre ventas (limpio)`,
    },
    {
      label: "− Gastos operativos (6xx + 613 dep.)",
      contable: gastosOp, limpio: gastosOp, isDetail: true,
    },
    {
      label: "= EBIT",
      contable: ebitContable, limpio: ebitLimpio, isSubtotal: true,
      note: `${pct(ebitLimpio, ventas)} sobre ventas (limpio)`,
    },
    {
      label: "+ Otros (7xx: FX, intereses, venta activo)",
      contable: otros, limpio: otros, isDetail: true,
    },
    {
      label: "= UTILIDAD NETA",
      contable: netaContable, limpio: netaLimpio, isTotal: true,
    },
  ];

  const renderAmt = (n: number | null, dim: boolean = false) => {
    if (n === null) return <span className="text-muted-foreground/40">—</span>;
    return (
      <span className={dim ? "text-muted-foreground" : ""}>{fmt(n)}</span>
    );
  };

  const renderDelta = (contable: number | null, limpio: number | null) => {
    if (contable === null || limpio === null) {
      if (contable !== null && limpio === null) {
        return (
          <span className="font-medium tabular-nums text-destructive">
            −{fmt(contable)}
          </span>
        );
      }
      // "Costo primo BOM" sólo en limpio: Δ = +limpio (aparece en limpio)
      if (limpio !== null && contable === null) {
        return (
          <span className="font-medium tabular-nums text-success">
            +{fmt(limpio)}
          </span>
        );
      }
      return <span className="text-muted-foreground/40">—</span>;
    }
    const d = limpio - contable;
    if (Math.abs(d) < 1) {
      return <span className="text-muted-foreground/40">—</span>;
    }
    return (
      <span
        className={cn(
          "font-medium tabular-nums",
          d > 0 ? "text-success" : "text-destructive"
        )}
      >
        {d > 0 ? "+" : ""}
        {fmt(d)}
      </span>
    );
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[44%]">Concepto</TableHead>
            <TableHead className="text-right">Contable</TableHead>
            <TableHead className="text-right">Limpio</TableHead>
            <TableHead className="text-right">Δ (limpio − contable)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow
              key={i}
              className={cn(
                r.isTotal && "bg-muted/60 font-semibold",
                r.isSubtotal && "bg-muted/30 font-medium",
                r.isHeader && "bg-muted/15 text-xs uppercase tracking-wide text-muted-foreground"
              )}
            >
              <TableCell className={r.isDetail ? "pl-8 text-sm" : ""}>
                {r.label}
                {r.note && (
                  <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                    {r.note}
                  </p>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.isHeader ? null : renderAmt(r.contable, r.isDetail && r.contable !== null && r.contable < 0 ? false : false)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.isHeader ? null : renderAmt(r.limpio)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.isHeader ? null : renderDelta(r.contable, r.limpio)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 bg-warning/5">
            <TableCell colSpan={4}>
              <p className="text-[11px] leading-snug text-muted-foreground">
                <span className="font-medium text-foreground">
                  Δ utilidad neta = {fmt(deltaNeta)}
                </span>
                {" — "}
                debería == residual 501.01 ({fmt(residual501_01)}).
                {Math.abs(deltaNeta - residual501_01) < 10
                  ? " ✓ Cuadra al peso."
                  : " ⚠ Drift detectado, revisar."}
                {" "}
                501.01 contable {fmt(cogs501_01Actual)} − costo primo BOM {fmt(costoPrimo)} ={" "}
                {fmt(residual501_01)} de CAPA{" "}
                {residual501_01 > 0 ? "pendiente que falta remover" : "removida en exceso"}.
              </p>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/* Tabla mensual contable vs ajustado ─────────────────────────────────── */
export function CogsMonthlyTable({ points }: { points: CogsMonthlyPoint[] }) {
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
export function CogsPerProductTable({ rows }: { rows: CogsPerProductRow[] }) {
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
