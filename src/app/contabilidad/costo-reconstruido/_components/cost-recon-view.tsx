import { formatCurrencyMXN, formatNumber, formatPercent } from "@/lib/formatters";
import { DataCsvButton, PrintButton } from "@/components/patterns";
import type {
  CostReconSnapshot,
  CostReconRow,
} from "@/lib/queries/sp13/finanzas/cost-reconstruction";
import { cn } from "@/lib/utils";

const CSV_COLUMNS = [
  { key: "ref", label: "Referencia" },
  { key: "nombre", label: "Producto" },
  { key: "uom", label: "UoM" },
  { key: "qty", label: "Cantidad vendida" },
  { key: "ventas", label: "Ventas MXN" },
  { key: "primo_unit", label: "Costo primo MP unit (último costo)" },
  { key: "primo_avg_unit", label: "Costo primo MP unit (promedio)" },
  { key: "fab_unit", label: "Factor fabricación unit" },
  { key: "op_unit", label: "Factor operación unit" },
  { key: "total_unit", label: "Costo total unit" },
  { key: "primo_total", label: "Costo primo MP total (último)" },
  { key: "primo_avg_total", label: "Costo primo MP total (promedio)" },
  { key: "fab_total", label: "Fabricación total" },
  { key: "op_total", label: "Operación total" },
  { key: "costo_total", label: "Costo total" },
  { key: "pct_mp_ventas", label: "% MP / ventas" },
  { key: "pct_fab_ventas", label: "% Fabricación / ventas" },
  { key: "pct_op_ventas", label: "% Operación / ventas" },
  { key: "margen", label: "Margen absorbido %" },
  { key: "fuente", label: "Fuente costo MP" },
];

function toCsvRows(rows: CostReconRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    ref: r.productRef ?? "",
    nombre: r.productName ?? "",
    uom: r.uom ?? "",
    qty: r.qtySold,
    ventas: r.revenueMxn,
    primo_unit: r.costoPrimoUnitMxn,
    primo_avg_unit: r.costoPrimoAvgUnitMxn,
    fab_unit: r.factorFabUnitMxn,
    op_unit: r.factorOpUnitMxn,
    total_unit: r.costoTotalUnitMxn,
    primo_total: r.costoPrimoTotalMxn,
    primo_avg_total: r.costoPrimoAvgTotalMxn,
    fab_total: r.gastosFabTotalMxn,
    op_total: r.gastosOpTotalMxn,
    costo_total: r.costoTotalMxn,
    pct_mp_ventas: r.pctMpVsRevenue != null ? Math.round(r.pctMpVsRevenue * 10) / 10 : "",
    pct_fab_ventas: r.pctFabVsRevenue != null ? Math.round(r.pctFabVsRevenue * 10) / 10 : "",
    pct_op_ventas: r.pctOpVsRevenue != null ? Math.round(r.pctOpVsRevenue * 10) / 10 : "",
    margen: r.marginFullPct ?? "",
    fuente: r.mpSource,
  }));
}

// Costos unitarios necesitan centavos (formatCurrencyMXN redondea a pesos).
const perUnit = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fUnit(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return perUnit.format(v);
}

function mesLabel(mes: string): string {
  const [y, m] = mes.split("-");
  const nombres = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${nombres[Number(m) - 1] ?? m} ${y}`;
}

const SOURCE_LABEL: Record<string, string> = {
  bom_recursivo: "BOM",
  importado_ultima_compra: "Import",
  ultima_compra: "Compra",
  avg_cost_fallback: "Avg",
  subproducto_cero: "Subprod",
};

export function CostReconView({ snapshot }: { snapshot: CostReconSnapshot }) {
  const {
    period,
    rangeLabel,
    rows,
    totals,
    nonMeterRows,
    nonMeterTotals,
    monthlyComparison,
  } = snapshot;

  // Top 30 por costo total para no saturar; resto agregado
  const TOP = 30;
  const topRows = rows.slice(0, TOP);
  const restRows = rows.slice(TOP);
  const rest = restRows.reduce(
    (acc, r) => {
      acc.costoTotalMxn += r.costoTotalMxn;
      acc.revenueMxn += r.revenueMxn;
      acc.qty += r.qtySold;
      return acc;
    },
    { costoTotalMxn: 0, revenueMxn: 0, qty: 0 },
  );

  return (
    <div className="space-y-8" data-table-export-root>
      {/* === Toolbar de export === */}
      <div className="flex items-center justify-end gap-2 print:hidden">
        <DataCsvButton
          rows={toCsvRows([...rows, ...nonMeterRows])}
          columns={CSV_COLUMNS}
          filename={`costo-reconstruido-${period}`}
          label="Exportar CSV (todos)"
        />
        <PrintButton />
      </div>

      {/* === Cómo se calcula (intro) === */}
      <section className="rounded-md border bg-muted/20 p-4 space-y-2">
        <h2 className="text-base font-semibold">Cómo leer este reporte</h2>
        <p className="text-sm text-muted-foreground">
          Reconstruimos el <strong>costo total de cada producto</strong>{" "}
          repartiéndole los gastos de la fábrica y de operación. Tres pasos:
        </p>
        <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
          <li>
            <strong>Factor de fabricación</strong> = gastos de fabricación del
            mes ÷ metros <strong>inspeccionados</strong> (lo producido; toda la
            tela se mide ahí).
          </li>
          <li>
            <strong>Factor de operación</strong> = gastos de operación del mes ÷
            metros <strong>vendidos</strong> (los gastos de venta pertenecen a lo
            que se vendió, no a lo que se produjo).
          </li>
          <li>
            <strong>Costo del producto</strong> = materia prima (último costo de
            compra) + factor fabricación + factor operación. Se compara contra el
            precio de venta → margen y % por capa.
          </li>
        </ol>
      </section>

      {/* === 1) Gasto por metro (fab ÷ inspeccionado, op ÷ vendido) === */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">1. Gasto por metro, por mes</h2>
        <p className="text-sm text-muted-foreground">
          Fabricación se reparte entre lo <strong>inspeccionado</strong>;
          operación entre lo <strong>vendido</strong>. El costo por producto usa
          estos factores.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Mes</th>
                <th className="px-3 py-2 text-right">Gasto fabricación</th>
                <th className="px-3 py-2 text-right">m inspeccionados</th>
                <th className="px-3 py-2 text-right bg-emerald-50">Factor fab ($/m)</th>
                <th className="px-3 py-2 text-right border-l">Gasto operación</th>
                <th className="px-3 py-2 text-right">m vendidos</th>
                <th className="px-3 py-2 text-right bg-emerald-50">Factor op ($/m)</th>
                <th className="px-3 py-2 text-right border-l font-semibold">Factor total ($/m)</th>
              </tr>
            </thead>
            <tbody>
              {monthlyComparison.map((m) => (
                <tr key={m.mes} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2">{mesLabel(m.mes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatCurrencyMXN(m.gastosFabMxn, { compact: true })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.inspeccionado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-emerald-50/50 font-medium">
                    {fUnit(m.factorFab)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums border-l text-muted-foreground">
                    {formatCurrencyMXN(m.gastosOpMxn, { compact: true })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.vendidoEquiv)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-emerald-50/50 font-medium">
                    {fUnit(m.factorOp)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums border-l font-semibold">
                    {fUnit(m.factorTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Fabricación ÷ inspeccionado</strong> (producido): lo no vendido
          queda en inventario. <strong>Operación ÷ vendido</strong>: el gasto de
          venta se reparte solo sobre lo que se vendió. &ldquo;m vendidos&rdquo;
          incluye los kg convertidos a metros-equivalentes.
        </p>
      </section>

      {/* === 2) Estructura sobre ventas (total del período) === */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          2. Estructura sobre ventas — {rangeLabel} ({period})
        </h2>
        <p className="text-sm text-muted-foreground">
          De cada peso vendido, cuánto se va en materia prima, fabricación y
          operación. Las tres capas + el margen suman 100% de las ventas.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <Kpi
            label="Materia prima / ventas"
            value={totals.pctMpVsRevenue != null ? formatPercent(totals.pctMpVsRevenue) : "—"}
            sub={formatCurrencyMXN(totals.mpTotalMxn, { compact: true })}
          />
          <Kpi
            label="Fabricación / ventas"
            value={totals.pctFabVsRevenue != null ? formatPercent(totals.pctFabVsRevenue) : "—"}
            sub={formatCurrencyMXN(totals.fabTotalMxn, { compact: true })}
            highlight
          />
          <Kpi
            label="Operación / ventas"
            value={totals.pctOpVsRevenue != null ? formatPercent(totals.pctOpVsRevenue) : "—"}
            sub={formatCurrencyMXN(totals.opTotalMxn, { compact: true })}
          />
          <Kpi
            label="Margen absorbido"
            value={totals.marginPct != null ? formatPercent(totals.marginPct) : "—"}
            sub={`Costo ${formatCurrencyMXN(totals.costoTotalMxn, { compact: true })}`}
          />
          <Kpi
            label="Ventas"
            value={formatCurrencyMXN(totals.revenueMxn, { compact: true })}
            sub={`${totals.productos} productos en metros`}
          />
        </div>
      </section>

      {/* === Reconstrucción por producto === */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          3. Costo reconstruido por producto (top {TOP})
        </h2>
        <p className="text-sm text-muted-foreground">
          Costo primo con <strong>último costo de compra</strong> + factor
          fabricación + factor operación. Los % son <strong>sobre las ventas
          del producto</strong>: cuánto de cada peso vendido se va en MP,
          fabricación y operación. <strong>Fab/ventas &gt; 100%</strong>{" "}
          significa que fabricar el producto cuesta más que su precio de venta.
          La tela vendida en <strong>kg</strong> se convierte a metros (CVU real
          o gramaje×ancho) para cobrarle el mismo factor — por eso su factor por
          unidad es mayor (1 kg ≈ 10-16 m).
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Vendido</th>
                <th className="px-3 py-2 text-right border-l">MP últ.</th>
                <th className="px-3 py-2 text-right text-muted-foreground">MP prom.</th>
                <th className="px-3 py-2 text-right">+Fab</th>
                <th className="px-3 py-2 text-right">+Op</th>
                <th className="px-3 py-2 text-right font-semibold">Costo total</th>
                <th className="px-3 py-2 text-right border-l">% MP/ventas</th>
                <th className="px-3 py-2 text-right bg-amber-50">% Fab/ventas</th>
                <th className="px-3 py-2 text-right">% Op/ventas</th>
                <th className="px-3 py-2 text-right border-l">Margen</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((r) => (
                <ProductRow key={r.productId} r={r} />
              ))}
              {/* Resto: oculto en pantalla, visible al imprimir → el PDF trae todos */}
              {restRows.map((r) => (
                <ProductRow
                  key={r.productId}
                  r={r}
                  className="hidden print:table-row"
                />
              ))}
              {restRows.length > 0 && (
                <tr className="border-t bg-muted/10 text-muted-foreground print:hidden">
                  <td className="px-3 py-2 italic">
                    +{restRows.length} productos restantes (en CSV / PDF salen todos)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatNumber(rest.qty)}
                  </td>
                  <td className="px-3 py-2 border-l" colSpan={5} />
                  <td className="px-3 py-2 text-right tabular-nums" />
                  <td className="px-3 py-2 text-right tabular-nums" />
                  <td className="px-3 py-2 text-right tabular-nums border-l" />
                  <td className="px-3 py-2 text-right tabular-nums" />
                </tr>
              )}
            </tbody>
            <tfoot className="bg-muted/30 font-semibold">
              <tr className="border-t-2">
                <td className="px-3 py-2" colSpan={6}>
                  Total ({totals.productos} productos)
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatCurrencyMXN(totals.costoTotalMxn, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums border-l">
                  {totals.pctMpVsRevenue != null ? formatPercent(totals.pctMpVsRevenue) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums bg-amber-50">
                  {totals.pctFabVsRevenue != null ? formatPercent(totals.pctFabVsRevenue) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {totals.pctOpVsRevenue != null ? formatPercent(totals.pctOpVsRevenue) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums border-l">
                  {totals.marginPct != null
                    ? formatPercent(totals.marginPct)
                    : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Lectura clave:</strong> los productos con costo primo bajo
          (jerseys ligeros) cargan el mismo factor por metro que los premium,
          así que su <strong>Fab/ventas</strong> sube a 50-60%+ y el margen a
          costo absorbido se vuelve negativo aunque su margen de MP se vea alto.
          Eso indica precios de venta que no cubren el costo fijo de producir
          cada metro.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>MP últ. vs prom.:</strong> la columna usa el{" "}
          <strong>último costo de compra</strong> (lo que costaría reponer hoy);
          &ldquo;MP prom.&rdquo; es el costo promedio (avg). En total la MP a
          último costo es{" "}
          {formatCurrencyMXN(totals.mpTotalMxn, { compact: true })} vs{" "}
          {formatCurrencyMXN(totals.mpAvgTotalMxn, { compact: true })} a
          promedio — la diferencia es el drift de precios de materia prima.
        </p>
      </section>

      {/* === Productos vendidos en kg (fuera del factor por metro) === */}
      {nonMeterRows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            4. Productos sin factor — solo materia prima
          </h2>
          <p className="text-sm text-muted-foreground">
            Estos {nonMeterTotals.productos} productos no tienen conversión a
            metros (desperdicio, servicio, pieza, o kg sin gramaje/CVU), así que
            <strong> no absorben factor</strong> y se muestran solo con su costo
            de MP y margen material. La tela en kg con conversión sí está en la
            tabla principal de arriba, ya costeada completa.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Producto</th>
                  <th className="px-3 py-2 text-right">Vendido</th>
                  <th className="px-3 py-2 text-right border-l">MP unit</th>
                  <th className="px-3 py-2 text-right">Ventas</th>
                  <th className="px-3 py-2 text-right">MP total</th>
                  <th className="px-3 py-2 text-right border-l">% MP/ventas</th>
                  <th className="px-3 py-2 text-right">Margen MP</th>
                </tr>
              </thead>
              <tbody>
                {nonMeterRows.map((r) => (
                  <tr key={r.productId} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">
                      {r.productRef ?? r.productName ?? r.productId}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatNumber(r.qtySold)} {r.uom ?? ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums border-l">
                      {fUnit(r.costoPrimoUnitMxn)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrencyMXN(r.revenueMxn)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrencyMXN(r.costoPrimoTotalMxn)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums border-l">
                      {r.pctMpVsRevenue != null ? formatPercent(r.pctMpVsRevenue) : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums font-medium",
                        r.marginFullPct != null && r.marginFullPct < 0
                          ? "text-red-600"
                          : "text-emerald-700",
                      )}
                    >
                      {r.marginFullPct != null ? formatPercent(r.marginFullPct) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30 font-semibold">
                <tr className="border-t-2">
                  <td className="px-3 py-2" colSpan={3}>
                    Total kg / otros ({nonMeterTotals.productos})
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(nonMeterTotals.revenueMxn, { compact: true })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(nonMeterTotals.mpTotalMxn, { compact: true })}
                  </td>
                  <td className="px-3 py-2 border-l" />
                  <td className="px-3 py-2 text-right tabular-nums">
                    {nonMeterTotals.marginMpPct != null
                      ? formatPercent(nonMeterTotals.marginMpPct)
                      : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Nota: su margen aquí es <strong>vs MP solamente</strong>; el costo
            real es mayor porque también consumen fabricación y operación que
            este modelo aún no les asigna.
          </p>
        </section>
      )}
    </div>
  );
}

function ProductRow({ r, className }: { r: CostReconRow; className?: string }) {
  // Fab/ventas alto = la fabricación se come gran parte del precio de venta.
  const fabHot =
    r.pctFabVsRevenue != null && r.pctFabVsRevenue >= 50;
  const fabCritical =
    r.pctFabVsRevenue != null && r.pctFabVsRevenue >= 100;
  return (
    <tr className={cn("border-t hover:bg-muted/20", className)}>
      <td className="px-3 py-2 font-medium">
        <div className="flex items-center gap-2">
          <span>{r.productRef ?? r.productName ?? r.productId}</span>
          <span className="rounded border border-slate-300 bg-slate-100 px-1 py-0.5 text-[10px] uppercase text-slate-500">
            {SOURCE_LABEL[r.mpSource] ?? r.mpSource}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {formatNumber(r.qtySold)} {r.uom ?? ""}
      </td>
      <td className="px-3 py-2 text-right tabular-nums border-l">
        {fUnit(r.costoPrimoUnitMxn)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {fUnit(r.costoPrimoAvgUnitMxn)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {fUnit(r.factorFabUnitMxn)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {fUnit(r.factorOpUnitMxn)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold">
        {fUnit(r.costoTotalUnitMxn)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums border-l">
        {r.pctMpVsRevenue != null ? formatPercent(r.pctMpVsRevenue) : "—"}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums bg-amber-50 font-medium",
          fabHot && "text-amber-700",
          fabCritical && "text-red-600 font-semibold",
        )}
      >
        {r.pctFabVsRevenue != null ? formatPercent(r.pctFabVsRevenue) : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {r.pctOpVsRevenue != null ? formatPercent(r.pctOpVsRevenue) : "—"}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums border-l font-medium",
          r.marginFullPct != null && r.marginFullPct < 0 && "text-red-600",
          r.marginFullPct != null &&
            r.marginFullPct >= 0 &&
            "text-emerald-700",
        )}
      >
        {r.marginFullPct != null ? formatPercent(r.marginFullPct) : "—"}
      </td>
    </tr>
  );
}

function Kpi({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        highlight && "border-emerald-300 bg-emerald-50/50",
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
