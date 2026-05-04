import { formatCurrencyMXN } from "@/lib/formatters";
import type { ReportRecommendation } from "@/lib/queries/sp13/finanzas/monthly-report-narrative";

const HORIZON_LABEL: Record<string, string> = {
  "30d": "30 días",
  "60d": "60 días",
  "90d": "90 días",
  estructural: "Estructural",
};

const CATEGORY_COLOR: Record<string, string> = {
  ventas: "bg-emerald-100 text-emerald-900",
  costos: "bg-orange-100 text-orange-900",
  cobranza: "bg-blue-100 text-blue-900",
  compras: "bg-purple-100 text-purple-900",
  financiero: "bg-indigo-100 text-indigo-900",
  operacion: "bg-amber-100 text-amber-900",
  fiscal: "bg-rose-100 text-rose-900",
};

export function RecommendationsSection({
  recommendations,
}: {
  recommendations: ReportRecommendation[];
}) {
  const sorted = [...recommendations].sort((a, b) => a.priority - b.priority);
  return (
    <ol className="space-y-3">
      {sorted.map((r) => (
        <li
          key={r.priority}
          className="rounded border bg-card p-4 print:break-inside-avoid"
        >
          <div className="flex items-baseline gap-3 flex-wrap">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background font-bold tabular-nums shrink-0">
              {r.priority}
            </div>
            <h3 className="text-base font-semibold flex-1 min-w-0">
              {r.title}
            </h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLOR[r.category] ?? "bg-muted"}`}
            >
              {r.category}
            </span>
          </div>
          <p className="text-sm mt-2 leading-relaxed">{r.description}</p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
            <span>
              <strong className="text-foreground">Dueño:</strong> {r.owner}
            </span>
            <span>
              <strong className="text-foreground">Plazo:</strong>{" "}
              {HORIZON_LABEL[r.horizon] ?? r.horizon}
            </span>
            {r.impactMxn != null ? (
              <span>
                <strong className="text-foreground">Impacto estimado:</strong>{" "}
                {formatCurrencyMXN(r.impactMxn, { compact: true })}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
