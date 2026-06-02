import { formatCurrencyMXN, formatNumber } from "@/lib/formatters";
import {
  GAS_PER_METER_ALERT_THRESHOLD,
  type RamaBurdenSummary,
} from "@/lib/queries/sp13/finanzas/rama-burden";
import { cn } from "@/lib/utils";

// Valores por metro / por litro necesitan centavos (formatCurrencyMXN
// global redondea a pesos enteros).
const perUnitFmt = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPerUnit(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return perUnitFmt.format(value);
}

function formatMes(mes: string): string {
  const [year, month] = mes.split("-");
  const nombres = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  const idx = Number(month) - 1;
  return `${nombres[idx] ?? month} ${year}`;
}

export function RamaBurdenCard({ summary }: { summary: RamaBurdenSummary }) {
  const { months, avgGasPorMetro, avgFabricacionPorMetro, totalMetros } =
    summary;

  if (months.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          La rama (OP-ACA) — costo por metro producido
        </h2>
        <p className="text-sm text-muted-foreground">
          Gas (504.01.0003) y gastos de fabricación (MOD 501.06 + overhead
          fábrica 504.01, <strong>sin costo primo MP</strong>) divididos entre
          los metros terminados en órdenes TL/OP-ACA. Alerta de gas cuando
          supera ${GAS_PER_METER_ALERT_THRESHOLD.toFixed(2)}/mt — señal de
          baja eficiencia (la rama tiene costo fijo de calentamiento).
        </p>
      </div>

      {/* KPIs promedio (meses completos) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Gas promedio
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {avgGasPorMetro != null
              ? `${formatPerUnit(avgGasPorMetro)} / mt`
              : "—"}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Fabricación promedio
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {avgFabricacionPorMetro != null
              ? `${formatPerUnit(avgFabricacionPorMetro)} / mt`
              : "—"}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Metros (meses completos)
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {formatNumber(totalMetros)} mt
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Umbral alerta gas
          </div>
          <div className="text-xl font-semibold tabular-nums">
            ${GAS_PER_METER_ALERT_THRESHOLD.toFixed(2)} / mt
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Mes</th>
              <th className="px-3 py-2 text-right">Metros OP-ACA</th>
              <th className="px-3 py-2 text-right border-l">Gas ($)</th>
              <th className="px-3 py-2 text-right">$/litro</th>
              <th className="px-3 py-2 text-right">Gas $/mt</th>
              <th className="px-3 py-2 text-right border-l">MOD (501.06)</th>
              <th className="px-3 py-2 text-right">OH fábrica (504.01)</th>
              <th className="px-3 py-2 text-right">Gastos fabricación</th>
              <th className="px-3 py-2 text-right font-semibold">
                Fabricación $/mt
              </th>
              <th className="px-3 py-2 text-right">+Dep $/mt</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const gasAlert =
                !m.isPartial &&
                m.gasPorMetro != null &&
                m.gasPorMetro > GAS_PER_METER_ALERT_THRESHOLD;
              return (
                <tr
                  key={m.mes}
                  className={cn(
                    "border-t hover:bg-muted/20",
                    m.isPartial && "opacity-60",
                  )}
                >
                  <td className="px-3 py-2 font-medium">
                    {formatMes(m.mes)}
                    {m.isPartial && (
                      <span className="ml-2 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                        Parcial
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatNumber(m.metrosOpAca)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums border-l">
                    {formatCurrencyMXN(m.gasGastoMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {m.gasPrecioLitro != null
                      ? formatPerUnit(m.gasPrecioLitro)
                      : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      gasAlert && "font-semibold text-red-600",
                    )}
                  >
                    {m.gasPorMetro != null && !m.isPartial
                      ? formatPerUnit(m.gasPorMetro)
                      : "—"}
                    {gasAlert && " ⚠"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums border-l">
                    {m.isPartial ? "—" : formatCurrencyMXN(m.modMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {m.isPartial ? "—" : formatCurrencyMXN(m.overheadMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {m.isPartial
                      ? "—"
                      : formatCurrencyMXN(m.gastosFabricacionMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {m.fabricacionPorMetro != null && !m.isPartial
                      ? formatPerUnit(m.fabricacionPorMetro)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {m.fabricacionConDepPorMetro != null && !m.isPartial
                      ? formatPerUnit(m.fabricacionConDepPorMetro)
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Gastos de fabricación</strong> = nómina fabril (501.06) +
        overhead de fábrica (504.01: gas, luz, agua, renta, mantenimiento).
        Excluye costo primo (materia prima), compras de importación (502) y
        gastos de operación (6xx). La columna <strong>+Dep</strong> agrega
        depreciación fábrica (504.08-23).
        <br />
        <strong>Por qué OP-ACA como denominador:</strong> el acabado (la rama)
        es el último proceso — prácticamente toda la tela vendible pasa por
        ahí, así que metros OP-ACA ≈ output total de la planta. Datos de
        producción disponibles desde enero 2026.
      </p>
    </section>
  );
}
