import { Calculator, AlertTriangle } from "lucide-react";
import { formatCurrencyMXN } from "@/lib/formatters";
import type {
  CapaHistory,
  CapaWorkflowMonth,
} from "@/lib/queries/sp13/finanzas/capa-workflow";

const SPANISH_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(p: string): string {
  const [y, m] = p.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS[m - 1]} ${y}`;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  ok: { label: "✓ OK", color: "text-emerald-700" },
  pending_small: { label: "Pendiente menor", color: "text-amber-700" },
  pending_large: { label: "🔴 Pendiente grande", color: "text-red-700" },
  over_corrected: { label: "Sobre-corregido", color: "text-blue-700" },
};

/**
 * Card específico para 501.01.01 que calcula la CAPA del mes a aplicar
 * y propone el asiento exacto a registrar en Odoo.
 */
export function CapaWorkflowCard({
  currentMonth,
  history,
}: {
  currentMonth: CapaWorkflowMonth;
  history: CapaHistory;
}) {
  const pending = currentMonth.pendingToPostMxn;
  const isPending = Math.abs(pending) >= 50000;
  const isOverCorrected = pending < -50000;

  return (
    <section className="rounded border-2 border-amber-300 bg-amber-50/30 p-5 space-y-4">
      <div className="flex items-start gap-2">
        <Calculator size={18} className="text-amber-700 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold">
            CAPA del mes a aplicar — {periodLabel(currentMonth.period)}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Asiento manual que la contadora debe registrar en Odoo para
            llevar 501.01.01 al costo MP real recursivo BOM.
          </p>
        </div>
      </div>

      {/* Cálculo */}
      <div className="rounded bg-white border p-4 text-sm space-y-2 font-mono">
        <Row
          label="(A) Saldo bruto 501.01.01 pre-CAPA"
          value={currentMonth.cogs501_01_01_grossMxn}
        />
        <Row
          label="(B) Costo MP real recursivo BOM"
          value={-currentMonth.costoPrimoBomMxn}
          minus
        />
        <hr className="border-dashed" />
        <Row
          label="(C = A − B) Residual de overhead inflado"
          value={currentMonth.residualMxn}
          bold
        />
        <Row
          label="(D) CAPA ya posteada en el mes"
          value={currentMonth.capaAlreadyPostedMxn}
          dim
        />
        <hr className="border-dashed" />
        <Row
          label="(E = C + D) PENDIENTE POR POSTEAR"
          value={pending}
          bold
          highlight
        />
        <Row
          label="    ↓ resultaría en saldo neto"
          value={currentMonth.cogs501_01_01_actualMxn - pending}
          dim
        />
      </div>

      {/* Status */}
      <div
        className={`text-sm font-medium ${STATUS_LABEL[currentMonth.status].color}`}
      >
        Status: {STATUS_LABEL[currentMonth.status].label}
        {isPending && pending > 0 ? (
          <span className="ml-2 font-normal text-muted-foreground">
            — la utilidad contable está sub-reportada por {formatCurrencyMXN(pending)}
          </span>
        ) : null}
        {isOverCorrected ? (
          <span className="ml-2 font-normal text-muted-foreground">
            — la CAPA aplicada removió más overhead del real; utilidad contable está sobre-reportada por {formatCurrencyMXN(-pending)}
          </span>
        ) : null}
      </div>

      {/* Asiento sugerido */}
      {isPending && pending > 0 ? (
        <div className="rounded border bg-white p-4 space-y-3">
          <p className="text-sm font-semibold">
            Asiento a registrar en Odoo (último día del mes)
          </p>
          <pre className="text-xs leading-relaxed font-mono bg-muted/30 rounded p-3 whitespace-pre overflow-x-auto">
{`Journal:    CAPA DE VALORACIÓN
Date:       ${currentMonth.period}-${lastDayOfMonth(currentMonth.period)}
Reference:  Ajuste CAPA overhead ${periodLabel(currentMonth.period)}

Líneas:
  Cr 501.01.01  Cost of sales              ${formatCurrencyMXN(pending)}
  Dr 504.01.0099 Overhead absorbido CAPA   ${formatCurrencyMXN(pending)}
                                            ───────────────
                                  TOTAL    ${formatCurrencyMXN(pending)}`}
          </pre>
          <p className="text-xs text-amber-900">
            <AlertTriangle size={11} className="inline mb-0.5 mr-1" />
            Si la cuenta <strong>504.01.0099 &ldquo;Overhead absorbido CAPA&rdquo;</strong>
            no existe, créala primero (tipo: expense_direct_cost, padre:
            504.01). Alternativa que ya usas: <strong>Dr 115.04.01 Productos
            terminados</strong> en lugar de 504.01.0099 (regresa overhead al
            inventario — válido pero crea inventario &ldquo;fantasma&rdquo;).
          </p>
        </div>
      ) : isOverCorrected ? (
        <div className="rounded border bg-white p-4 space-y-2">
          <p className="text-sm font-semibold text-blue-700">
            CAPA invertida sugerida (regresar parte de la corrección)
          </p>
          <pre className="text-xs leading-relaxed font-mono bg-muted/30 rounded p-3">
{`Journal:    CAPA DE VALORACIÓN
Date:       ${currentMonth.period}-${lastDayOfMonth(currentMonth.period)}
Reference:  Reverso CAPA exceso ${periodLabel(currentMonth.period)}

Líneas:
  Dr 501.01.01  Cost of sales              ${formatCurrencyMXN(-pending)}
  Cr 504.01.0099 Overhead absorbido CAPA   ${formatCurrencyMXN(-pending)}`}
          </pre>
        </div>
      ) : (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          ✓ Mes alineado. 501.01.01 está dentro de $50k del costo MP real BOM.
        </div>
      )}

      {/* History */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          Ver historial CAPA últimos 12 meses (total pendiente acumulado:{" "}
          <span className="font-semibold">
            {formatCurrencyMXN(history.totalPendingMxn, { compact: true })}
          </span>
          )
        </summary>
        <div className="mt-3 rounded border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">Mes</th>
                <th className="text-right px-2 py-1.5 font-medium">
                  501.01.01 bruto
                </th>
                <th className="text-right px-2 py-1.5 font-medium">
                  BOM real
                </th>
                <th className="text-right px-2 py-1.5 font-medium">
                  CAPA aplicada
                </th>
                <th className="text-right px-2 py-1.5 font-medium">
                  Pendiente
                </th>
              </tr>
            </thead>
            <tbody>
              {history.months.map((m) => (
                <tr key={m.period} className="border-t">
                  <td className="px-2 py-1">{periodLabel(m.period)}</td>
                  <td className="text-right px-2 py-1 tabular-nums">
                    {formatCurrencyMXN(m.cogs501_01_01_grossMxn, { compact: true })}
                  </td>
                  <td className="text-right px-2 py-1 tabular-nums">
                    {formatCurrencyMXN(m.costoPrimoBomMxn, { compact: true })}
                  </td>
                  <td className="text-right px-2 py-1 tabular-nums text-blue-700">
                    {formatCurrencyMXN(m.capaAlreadyPostedMxn, { compact: true })}
                  </td>
                  <td
                    className={`text-right px-2 py-1 tabular-nums font-semibold ${m.pendingToPostMxn > 50000 ? "text-red-700" : m.pendingToPostMxn < -50000 ? "text-blue-700" : "text-emerald-700"}`}
                  >
                    {m.pendingToPostMxn >= 0 ? "" : "−"}
                    {formatCurrencyMXN(Math.abs(m.pendingToPostMxn), { compact: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Row({
  label,
  value,
  bold,
  dim,
  highlight,
  minus,
}: {
  label: string;
  value: number;
  bold?: boolean;
  dim?: boolean;
  highlight?: boolean;
  minus?: boolean;
}) {
  const text = bold ? "font-semibold" : dim ? "text-muted-foreground" : "";
  const bg = highlight ? "bg-amber-100/50 -mx-1 px-1 rounded" : "";
  return (
    <div className={`flex items-baseline justify-between ${text} ${bg}`}>
      <span className="text-xs">{label}</span>
      <span className="tabular-nums">
        {minus && value < 0 ? "(" : ""}
        {formatCurrencyMXN(Math.abs(value))}
        {minus && value < 0 ? ")" : ""}
      </span>
    </div>
  );
}

function lastDayOfMonth(period: string): string {
  const [y, m] = period.split("-").map((s) => parseInt(s, 10));
  // último día del mes = día 0 del mes siguiente
  const d = new Date(y, m, 0);
  return String(d.getDate()).padStart(2, "0");
}
