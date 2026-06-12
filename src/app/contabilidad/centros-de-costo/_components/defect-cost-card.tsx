import { formatCurrencyMXN, formatNumber } from "@/lib/formatters";
import { DataCsvButton } from "@/components/patterns";
import {
  DEGRADACION_ALERT_MXN,
  type DefectCostSummary,
} from "@/lib/queries/sp13/finanzas/defect-cost";
import { cn } from "@/lib/utils";

const DEFECT_CSV_COLUMNS = [
  { key: "mes", label: "Mes" },
  { key: "tejido_kg", label: "Defectos tejido kg" },
  { key: "tejido_costo", label: "Defectos tejido MXN" },
  { key: "conv_kg", label: "Degradación kg" },
  { key: "conv_costo", label: "Degradación MXN" },
  { key: "ajuste_kg", label: "Ajustes valuados kg" },
  { key: "ajuste_costo", label: "Ajustes valuados MXN" },
  { key: "total", label: "Total MXN" },
  { key: "parcial", label: "Parcial" },
];

function formatMes(mes: string): string {
  const [year, month] = mes.split("-");
  const nombres = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  const idx = Number(month) - 1;
  return `${nombres[idx] ?? month} ${year}`;
}

export function DefectCostCard({ summary }: { summary: DefectCostSummary }) {
  const {
    months,
    avgDegradacionMxn,
    totalDegradacion12m,
    totalAjustesValuados12m,
  } = summary;

  if (months.length === 0) {
    return null;
  }

  const csvRows = months.map((m) => ({
    mes: m.mes,
    tejido_kg: m.tejidoKg,
    tejido_costo: Math.round(m.tejidoCostoMxn),
    conv_kg: m.convKg,
    conv_costo: Math.round(m.convCostoMxn),
    ajuste_kg: m.ajusteKg,
    ajuste_costo: Math.round(m.ajusteCostoMxn),
    total: Math.round(m.totalCostoMxn),
    parcial: m.isPartial ? "sí" : "",
  }));

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Costo de defectos y degradación a saldo
          </h2>
          <p className="text-sm text-muted-foreground">
            Medición analítica (el saldo en libros debe valer $0 — su material
            ya está cobrado en la tela buena vía BOM). Tres canales: defectos
            registrados como subproducto en tejido, tela degradada a saldo vía
            conversiones, y entradas de saldo por ajuste de inventario con
            valor (bandera roja: bajo la política nueva deben ser $0).
          </p>
        </div>
        <DataCsvButton
          rows={csvRows}
          columns={DEFECT_CSV_COLUMNS}
          filename="costo-defectos-saldo"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Degradación promedio / mes
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {avgDegradacionMxn != null
              ? formatCurrencyMXN(avgDegradacionMxn)
              : "—"}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Degradación últimos 12m
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {formatCurrencyMXN(totalDegradacion12m)}
          </div>
        </div>
        <div
          className={cn(
            "rounded-md border p-3",
            totalAjustesValuados12m > 0 && "border-red-300 bg-red-50",
          )}
        >
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Ajustes valuados 12m
          </div>
          <div
            className={cn(
              "text-xl font-semibold tabular-nums",
              totalAjustesValuados12m > 0 && "text-red-700",
            )}
          >
            {formatCurrencyMXN(totalAjustesValuados12m)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Mes</th>
              <th className="px-3 py-2 text-right border-l">
                Defectos tejido (kg)
              </th>
              <th className="px-3 py-2 text-right">Defectos tejido ($)</th>
              <th className="px-3 py-2 text-right border-l">
                Degradación (kg)
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                Degradación ($)
              </th>
              <th className="px-3 py-2 text-right border-l">
                Ajustes valuados ($)
              </th>
              <th className="px-3 py-2 text-right">Total ($)</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const convAlert =
                !m.isPartial && m.convCostoMxn > DEGRADACION_ALERT_MXN;
              const ajusteAlert = m.ajusteCostoMxn > 0;
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
                  <td className="px-3 py-2 text-right tabular-nums border-l text-muted-foreground">
                    {m.tejidoKg > 0 ? formatNumber(m.tejidoKg) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {m.tejidoCostoMxn > 0
                      ? formatCurrencyMXN(m.tejidoCostoMxn)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums border-l">
                    {m.convKg > 0 ? formatNumber(m.convKg) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums font-semibold",
                      convAlert && "text-red-600",
                    )}
                  >
                    {m.convCostoMxn > 0
                      ? formatCurrencyMXN(m.convCostoMxn)
                      : "—"}
                    {convAlert && " ⚠"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums border-l",
                      ajusteAlert
                        ? "font-semibold text-red-600"
                        : "text-muted-foreground",
                    )}
                  >
                    {m.ajusteCostoMxn > 0
                      ? `${formatCurrencyMXN(m.ajusteCostoMxn)} ⚠`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(m.totalCostoMxn)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Defectos tejido</strong> = kg de saldo nacido como subproducto
        en órdenes TL/OP-TEJ × costo unitario de esa orden (medido aunque el
        saldo entre a $0 en libros). <strong>Degradación</strong> = costo AVCO
        transferido de las telas al saldo en conversiones TL/CONV-ART — bajo la
        política &ldquo;saldo a $0&rdquo; solo deben traer costo los rollos de
        primera reclasificados de verdad; alerta cuando supera{" "}
        {formatCurrencyMXN(DEGRADACION_ALERT_MXN)}/mes.{" "}
        <strong>Ajustes valuados</strong> = entradas de saldo por conteo CON
        valor: siempre bandera roja (duplican costo que la BOM ya cobró a la
        tela buena, +12-18% vs peso teórico).
      </p>
    </section>
  );
}
