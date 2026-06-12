import { formatCurrencyMXN, formatNumber } from "@/lib/formatters";
import type { CostAuditSnapshot } from "@/lib/queries/sp13/finanzas/cost-audit";
import { cn } from "@/lib/utils";

function pct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function CostAuditView({ data }: { data: CostAuditSnapshot | null }) {
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin datos de costo para el período seleccionado.
      </p>
    );
  }

  const { departments, families, deptTotalMxn } = data;
  const famTotals = families.reduce(
    (a, f) => {
      a.mp += f.mpMxn;
      a.fab += f.fabMxn;
      a.op += f.opMxn;
      a.rev += f.revenueMxn;
      return a;
    },
    { mp: 0, fab: 0, op: 0, rev: 0 },
  );

  return (
    <div className="space-y-8">
      {/* Reconciliación */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Reconciliación: GL vs absorbido ({data.period})
        </h2>
        <p className="text-sm text-muted-foreground">
          Prueba de que el costo del GL se reparte completo, sin duplicados. La
          diferencia residual es <strong>suavizado</strong> (el factor refleja el
          promedio 12m; un mes con GL atípico sobre/sub-absorbe y se promedia en
          el año), no un doble conteo.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Pool GL fabricación" value={formatCurrencyMXN(data.glFabMxn)} />
          <Stat
            label="Fabricación absorbida"
            value={formatCurrencyMXN(data.absorbedFabMxn)}
          />
          <Stat
            label="Drift fab (absorbido vs GL)"
            value={pct(data.fabDriftPct)}
            tone={
              data.fabDriftPct != null && Math.abs(data.fabDriftPct) > 15
                ? "warn"
                : "ok"
            }
          />
          <Stat
            label="Operación absorbida"
            value={formatCurrencyMXN(data.absorbedOpMxn)}
          />
        </div>
        {data.byMonth.length > 1 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Mes</th>
                  <th className="px-3 py-2 text-right">GL fab</th>
                  <th className="px-3 py-2 text-right">Absorbido fab</th>
                  <th className="px-3 py-2 text-right">Drift</th>
                </tr>
              </thead>
              <tbody>
                {data.byMonth.map((m) => {
                  const drift =
                    m.glFab > 0 ? ((m.absorbedFab - m.glFab) / m.glFab) * 100 : null;
                  return (
                    <tr key={m.mes} className="border-t">
                      <td className="px-3 py-1.5">{m.mes}</td>
                      <td className="px-3 py-1.5 text-right">
                        {formatCurrencyMXN(m.glFab)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {formatCurrencyMXN(m.absorbedFab)}
                      </td>
                      <td className="px-3 py-1.5 text-right">{pct(drift)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Por departamento */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Costo por departamento (GL)</h2>
        <p className="text-sm text-muted-foreground">
          Centro de costo: mano de obra (501.06) + overhead (504.01 + renta
          contractual). Total: {formatCurrencyMXN(deptTotalMxn)}.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Departamento</th>
                <th className="px-3 py-2 text-right">MOD</th>
                <th className="px-3 py-2 text-right">Overhead</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">% del total</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.departamento} className="border-t">
                  <td className="px-3 py-1.5 font-medium">{d.departamento}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(d.modMxn)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(d.overheadMxn)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{formatCurrencyMXN(d.totalMxn)}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {deptTotalMxn > 0 ? `${((d.totalMxn / deptTotalMxn) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Por familia */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Costo absorbido por familia de producto</h2>
        <p className="text-sm text-muted-foreground">
          Cada producto cae en exactamente una familia (partición limpia, sin
          solapes). Margen = absorbido completo (MP + fab + op).
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Familia</th>
                <th className="px-3 py-2 text-right">Productos</th>
                <th className="px-3 py-2 text-right">MP</th>
                <th className="px-3 py-2 text-right">Fabricación</th>
                <th className="px-3 py-2 text-right">Operación</th>
                <th className="px-3 py-2 text-right">Ventas</th>
                <th className="px-3 py-2 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.familia} className="border-t">
                  <td className="px-3 py-1.5 font-medium">{f.familia}</td>
                  <td className="px-3 py-1.5 text-right">{formatNumber(f.n)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(f.mpMxn)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(f.fabMxn)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(f.opMxn)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(f.revenueMxn)}</td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-semibold",
                      f.marginPct != null && f.marginPct < 0
                        ? "text-red-600"
                        : "text-emerald-600",
                    )}
                  >
                    {pct(f.marginPct)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td className="px-3 py-1.5">Total</td>
                <td className="px-3 py-1.5 text-right">
                  {formatNumber(families.reduce((s, f) => s + f.n, 0))}
                </td>
                <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(famTotals.mp)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(famTotals.fab)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(famTotals.op)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(famTotals.rev)}</td>
                <td className="px-3 py-1.5 text-right">
                  {pct(
                    famTotals.rev > 0
                      ? ((famTotals.rev - famTotals.mp - famTotals.fab - famTotals.op) /
                          famTotals.rev) *
                          100
                      : null,
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value}
      </div>
    </div>
  );
}
