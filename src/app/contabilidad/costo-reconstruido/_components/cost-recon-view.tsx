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
  { key: "fab_unit", label: "Factor fabricación unit" },
  { key: "op_unit", label: "Factor operación unit" },
  { key: "total_unit", label: "Costo total unit" },
  { key: "primo_total", label: "Costo primo MP total" },
  { key: "fab_total", label: "Fabricación total" },
  { key: "op_total", label: "Operación total" },
  { key: "costo_total", label: "Costo total" },
  { key: "pct_mp", label: "% MP" },
  { key: "pct_fab", label: "% Fabricación" },
  { key: "pct_op", label: "% Operación" },
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
    fab_unit: r.factorFabUnitMxn,
    op_unit: r.factorOpUnitMxn,
    total_unit: r.costoTotalUnitMxn,
    primo_total: r.costoPrimoTotalMxn,
    fab_total: r.gastosFabTotalMxn,
    op_total: r.gastosOpTotalMxn,
    costo_total: r.costoTotalMxn,
    pct_mp: r.pctMp ?? "",
    pct_fab: r.pctFab ?? "",
    pct_op: r.pctOp ?? "",
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
  const { period, rangeLabel, factors, rows, totals, metersHistory } = snapshot;

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
          rows={toCsvRows(rows)}
          columns={CSV_COLUMNS}
          filename={`costo-reconstruido-${period}`}
          label="Exportar CSV (todos)"
        />
        <PrintButton />
      </div>

      {/* === Factores del período === */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">
            Factores de gasto por metro — {rangeLabel} ({period})
          </h2>
          <p className="text-sm text-muted-foreground">
            Gastos del mes ÷ metros de referencia producidos (OP-ACA + OP-V10).
            El factor se suma al costo primo MP de cada producto para
            reconstruir el costo total &ldquo;por fuera&rdquo;.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label="Metros referencia"
            value={factors ? `${formatNumber(factors.metrosReferencia)} m` : "—"}
            sub="OP-ACA + OP-V10"
          />
          <Kpi
            label="Factor fabricación"
            value={fUnit(factors?.factorFabXMetro)}
            sub={factors ? `${formatCurrencyMXN(factors.gastosFabMxn)} MOD+OH+dep` : ""}
          />
          <Kpi
            label="Factor operación"
            value={fUnit(factors?.factorOpXMetro)}
            sub={factors ? `${formatCurrencyMXN(factors.gastosOpMxn)} gastos 6xx` : ""}
          />
          <Kpi
            label="Factor total"
            value={fUnit(factors?.factorTotalXMetro)}
            sub="$/metro absorbido"
            highlight
          />
        </div>
      </section>

      {/* === Totales del costeo reconstruido === */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Estructura de costo absorbido — total del mes
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <Kpi
            label="Materia prima"
            value={formatCurrencyMXN(totals.mpTotalMxn)}
            sub={totals.pctMp != null ? `${formatPercent(totals.pctMp)} del costo` : ""}
          />
          <Kpi
            label="Fabricación"
            value={formatCurrencyMXN(totals.fabTotalMxn)}
            sub={totals.pctFab != null ? `${formatPercent(totals.pctFab)} del costo` : ""}
          />
          <Kpi
            label="Operación"
            value={formatCurrencyMXN(totals.opTotalMxn)}
            sub={totals.pctOp != null ? `${formatPercent(totals.pctOp)} del costo` : ""}
          />
          <Kpi
            label="Costo total"
            value={formatCurrencyMXN(totals.costoTotalMxn)}
            sub={`${totals.productos} productos`}
            highlight
          />
          <Kpi
            label="Margen absorbido"
            value={totals.marginPct != null ? formatPercent(totals.marginPct) : "—"}
            sub={`Ventas ${formatCurrencyMXN(totals.revenueMxn, { compact: true })}`}
          />
        </div>
      </section>

      {/* === Metros fabricados vs vendidos === */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Metros fabricados vs vendidos</h2>
        <p className="text-sm text-muted-foreground">
          Referencia = OP-ACA + OP-V10 (terminados). Vendidos = productos con
          UoM en metros (out_invoice, dedup). Ratio &lt;1 = produces más de lo
          que vendes (construyes inventario); &gt;1 = vendes de inventario.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Mes</th>
                <th className="px-3 py-2 text-right">OP-ACA</th>
                <th className="px-3 py-2 text-right">OP-V10</th>
                <th className="px-3 py-2 text-right border-l">Metros ref.</th>
                <th className="px-3 py-2 text-right">Metros vendidos</th>
                <th className="px-3 py-2 text-right">Kg vendidos</th>
                <th className="px-3 py-2 text-right">Ratio v/p</th>
              </tr>
            </thead>
            <tbody>
              {metersHistory.map((m) => (
                <tr
                  key={m.mes}
                  className={cn(
                    "border-t hover:bg-muted/20",
                    m.mes === period && "bg-muted/30 font-medium",
                  )}
                >
                  <td className="px-3 py-2">{mesLabel(m.mes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.metrosOpAca)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.metrosOpV10)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums border-l">
                    {formatNumber(m.metrosReferencia)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatNumber(m.metrosVendidos)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(m.kgVendidos)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums font-medium",
                      m.ratioVendidoProducido != null &&
                        m.ratioVendidoProducido > 1
                        ? "text-amber-600"
                        : "text-emerald-700",
                    )}
                  >
                    {m.ratioVendidoProducido != null
                      ? m.ratioVendidoProducido.toFixed(2)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* === Reconstrucción por producto === */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Costo reconstruido por producto (top {TOP})
        </h2>
        <p className="text-sm text-muted-foreground">
          Costo primo con <strong>último costo de compra</strong> + factor
          fabricación + factor operación. El % muestra cuánto del costo total
          es MP vs gastos absorbidos. Margen = vs precio de venta a costo
          absorbido completo.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Vendido</th>
                <th className="px-3 py-2 text-right border-l">Primo MP</th>
                <th className="px-3 py-2 text-right">+Fab</th>
                <th className="px-3 py-2 text-right">+Op</th>
                <th className="px-3 py-2 text-right font-semibold">Costo total</th>
                <th className="px-3 py-2 text-right border-l">% MP</th>
                <th className="px-3 py-2 text-right">% Gastos</th>
                <th className="px-3 py-2 text-right border-l">Margen</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((r) => (
                <ProductRow key={r.productId} r={r} />
              ))}
              {restRows.length > 0 && (
                <tr className="border-t bg-muted/10 text-muted-foreground">
                  <td className="px-3 py-2 italic">
                    +{restRows.length} productos restantes
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatNumber(rest.qty)}
                  </td>
                  <td className="px-3 py-2 border-l" colSpan={4} />
                  <td className="px-3 py-2 text-right tabular-nums" />
                  <td className="px-3 py-2 text-right tabular-nums border-l" />
                  <td className="px-3 py-2 text-right tabular-nums" />
                </tr>
              )}
            </tbody>
            <tfoot className="bg-muted/30 font-semibold">
              <tr className="border-t-2">
                <td className="px-3 py-2" colSpan={5}>
                  Total ({totals.productos} productos)
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatCurrencyMXN(totals.costoTotalMxn, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums border-l">
                  {totals.pctMp != null ? formatPercent(totals.pctMp) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {totals.pctFab != null && totals.pctOp != null
                    ? formatPercent(totals.pctFab + totals.pctOp)
                    : "—"}
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
          así que su % de gastos sube a 60%+ y el margen a costo absorbido puede
          ser negativo aunque su margen de MP se vea alto. Eso indica precios de
          venta que no cubren el costo fijo de producir cada metro.
        </p>
      </section>
    </div>
  );
}

function ProductRow({ r }: { r: CostReconRow }) {
  const pctGastos =
    r.pctFab != null && r.pctOp != null ? r.pctFab + r.pctOp : null;
  return (
    <tr className="border-t hover:bg-muted/20">
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
        {fUnit(r.factorFabUnitMxn)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {fUnit(r.factorOpUnitMxn)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold">
        {fUnit(r.costoTotalUnitMxn)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums border-l">
        {r.pctMp != null ? formatPercent(r.pctMp) : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {pctGastos != null ? formatPercent(pctGastos) : "—"}
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
