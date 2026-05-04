import { formatCurrencyMXN } from "@/lib/formatters";
import type { AccountSourceJournal } from "@/lib/queries/sp13/finanzas/account-expense-detail";

export function SourceJournalBreakdown({
  sources,
}: {
  sources: AccountSourceJournal[];
}) {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No hay asientos en el período.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded border overflow-hidden text-sm">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 font-medium">
                Source journal
              </th>
              <th className="text-right px-3 py-2 font-medium w-20">Líneas</th>
              <th className="text-right px-3 py-2 font-medium w-28">Net</th>
              <th className="text-right px-3 py-2 font-medium w-16">% del</th>
              <th className="text-left px-3 py-2 font-medium">
                Top contrapartes (cuenta destino del débito/crédito)
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => (
              <tr key={i} className="border-b last:border-b-0 align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{s.journalName}</div>
                  {s.diagnostic ? (
                    <div className="text-xs text-muted-foreground mt-1 italic leading-snug">
                      {s.diagnostic}
                    </div>
                  ) : null}
                </td>
                <td className="text-right px-3 py-2 tabular-nums">
                  {s.lineCount}
                </td>
                <td
                  className={`text-right px-3 py-2 tabular-nums font-semibold ${
                    s.netMxn >= 0 ? "" : "text-emerald-700"
                  }`}
                >
                  {s.netMxn >= 0 ? "" : "−"}
                  {formatCurrencyMXN(Math.abs(s.netMxn), { compact: true })}
                </td>
                <td className="text-right px-3 py-2 tabular-nums text-xs text-muted-foreground">
                  {s.pctOfNet.toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                  {s.topContraAccounts || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded bg-muted/20 border-l-4 border-blue-400 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Cómo leer esto:</strong> &ldquo;Source
        journal&rdquo; es el journal de Odoo que generó el asiento. &ldquo;Top contrapartes&rdquo;
        muestra contra qué cuentas se balanceó el monto (típicamente 115.x
        inventarios para cuentas COGS, o 201/205.x cuentas por pagar para
        gastos via factura). Si el diagnóstico aparece en cursiva, es una
        regla heurística — verifica con tu contadora si te suena raro.
      </div>
    </div>
  );
}
