import { formatCurrencyMXN, formatNumber } from "@/lib/formatters";
import type {
  ContributionSnapshot,
  ContributionRow,
} from "@/lib/queries/sp13/finanzas/contribution-margin";
import { cn } from "@/lib/utils";

const perUnit = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fU = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : perUnit.format(v);
const fPct = (v: number | null) =>
  v == null || Number.isNaN(v) ? "—" : `${v.toFixed(1)}%`;

const TOP = 60;

export function ContributionView({ data }: { data: ContributionSnapshot | null }) {
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin datos para el período seleccionado.
      </p>
    );
  }
  const rows = data.rows.slice(0, TOP);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">
          <strong>Costeo por margen de contribución</strong> (mejor práctica para
          decisiones de precio y mezcla). Costo variable = materia prima + energía
          (lo único que escala con producción). MOD, renta, depreciación, overhead
          y operación son <strong>costos fijos del período</strong> — se cubren con
          la <strong>suma</strong> de contribuciones, no se reparten por unidad. Un
          producto vale la pena si su contribución es positiva, aunque su costo
          absorbido salga mayor al precio.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Ventas" value={formatCurrencyMXN(data.revenueMxn)} />
          <Stat
            label="Costo variable (MP + energía)"
            value={formatCurrencyMXN(data.variableMxn)}
          />
          <Stat
            label="Margen de contribución"
            value={`${formatCurrencyMXN(data.contributionMxn)} (${fPct(data.cmPctGlobal)})`}
            tone="good"
          />
          <Stat
            label="Costos fijos (período)"
            value={formatCurrencyMXN(data.fixedPeriodMxn)}
          />
          <Stat
            label="Resultado (contribución − fijos)"
            value={formatCurrencyMXN(data.resultMxn)}
            tone={data.resultMxn >= 0 ? "good" : "bad"}
          />
          <Stat
            label="Fijos prom. mensual (12m)"
            value={formatCurrencyMXN(data.fixedAvgMonthlyMxn)}
          />
          <Stat
            label="Punto de equilibrio (ventas/mes)"
            value={
              data.breakEvenMonthlyMxn != null
                ? formatCurrencyMXN(data.breakEvenMonthlyMxn)
                : "—"
            }
            tone="warn"
          />
          <Stat
            label="Productos con contribución negativa"
            value={formatNumber(data.rows.filter((r) => (r.cmPct ?? 0) < 0).length)}
            tone={
              data.rows.some((r) => (r.cmPct ?? 0) < 0) ? "bad" : "good"
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Contribución por producto (top {TOP})
        </h2>
        <p className="text-sm text-muted-foreground">
          Ordenado por contribución total al período. <strong>CM/u</strong> =
          precio − costo variable por unidad.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">UoM</th>
                <th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-right">Ventas</th>
                <th className="px-3 py-2 text-right">MP</th>
                <th className="px-3 py-2 text-right">Energía</th>
                <th className="px-3 py-2 text-right">Costo var.</th>
                <th className="px-3 py-2 text-right">Contribución</th>
                <th className="px-3 py-2 text-right">CM/u</th>
                <th className="px-3 py-2 text-right">CM %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: ContributionRow) => (
                <tr key={r.productRef ?? r.productName} className="border-t">
                  <td className="px-3 py-1.5 font-medium">
                    {r.productRef ?? r.productName}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{r.uom}</td>
                  <td className="px-3 py-1.5 text-right">{formatNumber(Math.round(r.qtySold))}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(r.revenueMxn)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(r.mpMxn)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(r.energiaVarMxn)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrencyMXN(r.costoVariableMxn)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{formatCurrencyMXN(r.contribucionMxn)}</td>
                  <td className="px-3 py-1.5 text-right">{fU(r.cmUnitMxn)}</td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-semibold",
                      (r.cmPct ?? 0) < 0 ? "text-red-600" : "text-emerald-600",
                    )}
                  >
                    {fPct(r.cmPct)}
                  </td>
                </tr>
              ))}
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
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-base font-semibold",
          tone === "good" && "text-emerald-600",
          tone === "bad" && "text-red-600",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value}
      </div>
    </div>
  );
}
