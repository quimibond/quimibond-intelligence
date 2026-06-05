import { formatCurrencyMXN, formatNumber } from "@/lib/formatters";
import { DataCsvButton } from "@/components/patterns";
import type { WorkcenterStandardSummary } from "@/lib/queries/sp13/finanzas/workcenter-standard";
import { cn } from "@/lib/utils";

const CSV_COLUMNS = [
  { key: "mes", label: "Mes" },
  { key: "mod", label: "MOD" },
  { key: "renta", label: "Renta contractual" },
  { key: "energia", label: "Energia/servicios" },
  { key: "otros", label: "Mantto/otros" },
  { key: "deprec", label: "Deprec. maquinaria" },
  { key: "total", label: "Total fabril" },
  { key: "horas", label: "Horas-maquina" },
  { key: "excluido", label: "Excluido del promedio" },
];

const perHour = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fHour(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return perHour.format(v);
}

function formatMes(mes: string): string {
  const [year, month] = mes.split("-");
  const nombres = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${nombres[Number(month) - 1] ?? month} ${year}`;
}

export function WorkcenterStandardCard({
  summary,
}: {
  summary: WorkcenterStandardSummary;
}) {
  const { months, config, norm, suggested } = summary;
  if (months.length === 0) return null;

  const csvRows = months.map((m) => ({
    mes: m.mes,
    mod: m.modMxn,
    renta: m.rentaMxn,
    energia: m.energiaServiciosMxn,
    otros: m.manttoOtrosMxn,
    deprec: m.deprecMaquinariaMxn,
    total: m.totalFabrilMxn,
    horas: m.horasMaquina,
    excluido: m.excluido ? "si" : "",
  }));

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Costo estándar del workcenter — Tejido
          </h2>
          <p className="text-sm text-muted-foreground">
            Costo normalizado para fijar el <strong>costo por hora</strong> en
            Odoo. La renta es <strong>contractual fija</strong> (no el GL
            volátil); la tarifa sugerida = costo normalizado ÷ horas-máquina
            objetivo. Edita la config (horas, % depreciación) en{" "}
            <code>workcenter_cost_config</code> para moverlo.
          </p>
        </div>
        <DataCsvButton
          rows={csvRows}
          columns={CSV_COLUMNS}
          filename="costo-estandar-tejido"
          label="Exportar CSV"
        />
      </div>

      {/* Tarifa sugerida */}
      {suggested && config && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <RateBox
            label="costs_hour (máquina)"
            value={fHour(suggested.costsHour)}
            sub="overhead ÷ horas obj."
            highlight
          />
          <RateBox
            label="employee_costs_hour"
            value={fHour(suggested.employeeCostsHour)}
            sub="MOD ÷ horas obj."
            highlight
          />
          <RateBox
            label="Total por hora-máquina"
            value={fHour(suggested.totalHour)}
            sub={`${formatNumber(config.targetMachineHours ?? 0)} h-máq/mes obj.`}
          />
          <RateBox
            label="Base"
            value={`${norm?.nMeses ?? 0} meses`}
            sub={`${config.nMachines ?? 0} máquinas · dep ${config.machineDeprecPct}%`}
          />
        </div>
      )}

      {/* Promedio normalizado por componente */}
      {norm && (
        <p className="text-xs text-muted-foreground">
          Promedio mensual normalizado ({norm.nMeses} meses válidos): MOD{" "}
          {formatCurrencyMXN(norm.modMxn, { compact: true })} · Renta{" "}
          {formatCurrencyMXN(norm.rentaMxn, { compact: true })} · Energía{" "}
          {formatCurrencyMXN(norm.energiaServiciosMxn, { compact: true })} ·
          Mantto/otros {formatCurrencyMXN(norm.manttoOtrosMxn, { compact: true })}{" "}
          · Deprec. máq.{" "}
          {formatCurrencyMXN(norm.deprecMaquinariaMxn, { compact: true })} ={" "}
          <strong>{formatCurrencyMXN(norm.totalMxn, { compact: true })}/mes</strong>
          .
        </p>
      )}

      {/* Tabla mes con mes */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Mes</th>
              <th className="px-3 py-2 text-right">MOD</th>
              <th className="px-3 py-2 text-right">Renta</th>
              <th className="px-3 py-2 text-right">Energía</th>
              <th className="px-3 py-2 text-right">Mantto/otros</th>
              <th className="px-3 py-2 text-right">Deprec. máq.</th>
              <th className="px-3 py-2 text-right font-semibold">Total fabril</th>
              <th className="px-3 py-2 text-right">Horas-máq.</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr
                key={m.mes}
                className={cn(
                  "border-t",
                  m.excluido ? "text-muted-foreground/60 italic" : "hover:bg-muted/20",
                )}
              >
                <td className="px-3 py-2">
                  {formatMes(m.mes)}
                  {m.excluido && (
                    <span className="ml-1 text-[10px] uppercase">(fuera)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrencyMXN(m.modMxn, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrencyMXN(m.rentaMxn, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrencyMXN(m.energiaServiciosMxn, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrencyMXN(m.manttoOtrosMxn, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrencyMXN(m.deprecMaquinariaMxn, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatCurrencyMXN(m.totalFabrilMxn, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {m.horasMaquina > 0 ? formatNumber(m.horasMaquina) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Meses en gris se excluyen del promedio: reverso de cierre anual
        (diciembre) o mes corriente incompleto. Las{" "}
        <strong>horas-máquina del GL no son confiables</strong> antes de
        mayo-2026 (tracking parcial); por eso la tarifa usa las{" "}
        <strong>horas objetivo</strong> de la config, no las del mes. Ajusta las
        horas objetivo conforme se estabilice el tracking real.
      </p>
    </section>
  );
}

function RateBox({
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
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
