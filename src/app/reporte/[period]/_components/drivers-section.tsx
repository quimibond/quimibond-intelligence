import { formatCurrencyMXN } from "@/lib/formatters";
import type { MonthlyReport } from "@/lib/queries/sp13/finanzas/monthly-report";

const BUCKET_LABEL: Record<string, string> = {
  income_4xx: "Ventas",
  income_7xx: "Otros (7xx)",
  cogs_501_01: "COGS contable",
  mod_501_06: "Mano de obra",
  compras_502: "Compras imp.",
  overhead_504_01: "Overhead",
  dep_504_08_23: "Dep. fábrica",
  dep_corpo_613: "Dep. corpo",
  gastos_op_6xx: "Gastos op.",
};

export function DriversSection({ report }: { report: MonthlyReport }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div>
        <h3 className="text-sm font-medium mb-2">Clientes que ganaron</h3>
        <DriverList
          rows={report.customerGainers.map((c) => ({
            label: c.companyName,
            sub: `${formatCurrencyMXN(c.revenuePrev, { compact: true })} → ${formatCurrencyMXN(c.revenueCurr, { compact: true })}`,
            delta: c.delta,
          }))}
          positive
          emptyMsg="No hubo clientes con crecimiento >$50k"
        />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-2">Clientes que perdieron</h3>
        <DriverList
          rows={report.customerLosers.map((c) => ({
            label: c.companyName,
            sub: `${formatCurrencyMXN(c.revenuePrev, { compact: true })} → ${formatCurrencyMXN(c.revenueCurr, { compact: true })}`,
            delta: c.delta,
          }))}
          positive={false}
          emptyMsg="No hubo clientes con caída >$50k"
        />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-2">
          Cuentas que mejoraron utilidad
        </h3>
        <DriverList
          rows={report.accountHelpers.map((a) => ({
            label: `${a.accountCode} · ${a.accountName}`,
            sub: BUCKET_LABEL[a.bucket] ?? a.bucket,
            delta: a.delta,
          }))}
          positive
          emptyMsg="Sin cuentas que ayudaran significativamente"
        />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-2">
          Cuentas que castigaron utilidad
        </h3>
        <DriverList
          rows={report.accountHurters.map((a) => ({
            label: `${a.accountCode} · ${a.accountName}`,
            sub: BUCKET_LABEL[a.bucket] ?? a.bucket,
            delta: a.delta,
          }))}
          positive={false}
          emptyMsg="Sin cuentas con impacto negativo significativo"
        />
      </div>
    </div>
  );
}

function DriverList({
  rows,
  positive,
  emptyMsg,
}: {
  rows: Array<{ label: string; sub: string; delta: number }>;
  positive: boolean;
  emptyMsg: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">{emptyMsg}</p>
    );
  }
  const accent = positive ? "text-emerald-700" : "text-red-700";
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r, i) => (
        <li
          key={i}
          className="flex items-baseline justify-between gap-3 border-b border-dashed pb-1"
        >
          <div className="min-w-0">
            <div className="truncate capitalize">{r.label}</div>
            <div className="text-xs text-muted-foreground">{r.sub}</div>
          </div>
          <div className={`tabular-nums font-medium ${accent}`}>
            {r.delta >= 0 ? "+" : ""}
            {formatCurrencyMXN(r.delta, { compact: true })}
          </div>
        </li>
      ))}
    </ul>
  );
}
