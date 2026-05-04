import { formatCurrencyMXN, formatNumber } from "@/lib/formatters";
import type {
  CostCentersSnapshot,
  CostCenterRow,
} from "@/lib/queries/sp13/finanzas/cost-centers";
import { cn } from "@/lib/utils";

const NATURE_LABEL: Record<CostCenterRow["nature"], string> = {
  fabril_directo: "Fabril directo",
  fabril_indirecto: "Fabril indirecto",
  admin: "Admin / soporte",
};

const NATURE_BADGE: Record<CostCenterRow["nature"], string> = {
  fabril_directo: "bg-emerald-100 text-emerald-800 border-emerald-300",
  fabril_indirecto: "bg-amber-100 text-amber-800 border-amber-300",
  admin: "bg-slate-100 text-slate-700 border-slate-300",
};

function formatBurden(row: CostCenterRow): string {
  if (row.burdenRatePerUnit == null) return "—";
  if (row.qtyProduced <= 0) return "—";
  const uom = row.outputUom ?? "u";
  return `${formatCurrencyMXN(row.burdenRatePerUnit)} / ${uom}`;
}

function formatQty(row: CostCenterRow): string {
  if (row.qtyProduced <= 0) return "—";
  const uom = row.outputUom ?? "u";
  return `${formatNumber(row.qtyProduced)} ${uom}`;
}

export function CostCentersTable({
  snapshot,
}: {
  snapshot: CostCentersSnapshot;
}) {
  const { rows, totals, period, rangeLabel } = snapshot;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          Desglose por centro — {rangeLabel} ({period})
        </h2>
        <p className="text-sm text-muted-foreground">
          Nómina via 501.06.* (parser regex sobre journal ref de NOMINAS).
          Overhead via 504.01.* (asignación directa luz→TEJIDO, gas→ACABADO,
          agua→TINTORERIA, agujados→TEJIDO; renta por lote; resto prorrateado
          por producción de fabril_directo).
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Centro</th>
              <th className="px-3 py-2 text-left">Naturaleza</th>
              <th className="px-3 py-2 text-right">Nómina (501.06)</th>
              <th className="px-3 py-2 text-right">Renta</th>
              <th className="px-3 py-2 text-right">Servicios</th>
              <th className="px-3 py-2 text-right">Otro OH</th>
              <th className="px-3 py-2 text-right">Total OH</th>
              <th className="px-3 py-2 text-right border-l">Total mes</th>
              <th className="px-3 py-2 text-right">Producción</th>
              <th className="px-3 py-2 text-right">Burden / unidad</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No hay datos para este período.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.costCenterCode}
                  className="border-t hover:bg-muted/20"
                >
                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{row.costCenterName}</span>
                      {row.hasWorkcenter && (
                        <span
                          title={`Workcenter activo (go-live ${row.workcenterGoLiveDate ?? "?"})`}
                          className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800"
                        >
                          WC
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.costCenterCode}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs",
                        NATURE_BADGE[row.nature],
                      )}
                    >
                      {NATURE_LABEL[row.nature]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(row.nominaMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(row.rentMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(row.utilitiesMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(row.otherOverheadMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(row.totalOverheadMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold border-l">
                    {formatCurrencyMXN(row.totalCostMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatQty(row)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatBurden(row)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="bg-muted/30 font-semibold">
            <tr className="border-t-2">
              <td className="px-3 py-2" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrencyMXN(totals.nominaMxn)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrencyMXN(totals.rentMxn)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrencyMXN(totals.utilitiesMxn)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrencyMXN(totals.otherOverheadMxn)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrencyMXN(totals.totalOverheadMxn)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums border-l">
                {formatCurrencyMXN(totals.totalCostMxn)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                —
              </td>
              <td className="px-3 py-2 text-right tabular-nums">—</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Cómo se asigna nómina:</strong> el journal ref de NOMINAS suele
        traer el nombre del depto (&ldquo;NOMINA TEJIDO Q1 ABRIL 2026&rdquo;).
        Lo que no matchea ningún patrón queda en bucket{" "}
        <code className="rounded bg-muted px-1">SIN_CLASIFICAR</code>.
        <br />
        <strong>Cómo se asigna overhead:</strong> luz/gas/agua/agujados se
        asignan directo al centro consumidor; renta se reparte por lote según
        contratos del CEO; el resto de 504.01 se prorratea por producción de
        los centros fabril_directo.
      </p>
    </section>
  );
}
