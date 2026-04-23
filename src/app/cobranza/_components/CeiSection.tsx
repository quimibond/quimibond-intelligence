import { TrendingDown } from "lucide-react";

import { EmptyState, StatusBadge } from "@/components/patterns";
import {
  getCollectionEffectiveness,
  type CeiHealth,
} from "@/lib/queries/analytics";

const HEALTH_LABEL: Record<CeiHealth, string> = {
  healthy: "Saludable",
  watch: "Vigilar",
  at_risk: "En riesgo",
  degraded: "Degradado",
  too_recent: "Reciente",
};

const HEALTH_BAR_BG: Record<CeiHealth, string> = {
  healthy: "bg-success",
  watch: "bg-info",
  at_risk: "bg-warning",
  degraded: "bg-danger",
  too_recent: "bg-muted-foreground/40",
};

function formatCohortMonth(iso: string): string {
  if (!iso) return "—";
  // Parse date parts explicitly to avoid UTC-to-local timezone shift
  // (new Date("YYYY-MM-DD") is UTC midnight which can roll back to the previous month)
  const [year, month] = iso.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

export async function CeiSection() {
  const rows = await getCollectionEffectiveness(12);
  const useful = rows.filter((r) => r.cohort_age_months >= 2).slice(0, 8);

  if (useful.length === 0) {
    return (
      <EmptyState
        icon={TrendingDown}
        title="Sin datos de cohort"
        description="No hay suficientes meses cerrados para calcular CEI."
        compact
      />
    );
  }

  return (
    <ul className="space-y-2">
      {useful.map((r) => {
        const pct = Math.max(0, Math.min(100, Number(r.cei_pct) || 0));
        return (
          <li key={r.cohort_month} className="flex items-center gap-3">
            <div className="w-16 text-xs tabular-nums text-muted-foreground">
              {formatCohortMonth(r.cohort_month)}
            </div>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted">
              <div
                className={`absolute inset-y-0 left-0 ${HEALTH_BAR_BG[r.health_status]}`}
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
              <div className="relative flex h-full items-center justify-between px-2 text-xs font-medium">
                <span>{pct.toFixed(0)}%</span>
                <span className="text-muted-foreground">
                  {r.avg_days_to_pay != null ? `${r.avg_days_to_pay}d` : "—"}
                </span>
              </div>
            </div>
            <StatusBadge
              kind="generic"
              value={HEALTH_LABEL[r.health_status]}
              density="compact"
            />
          </li>
        );
      })}
    </ul>
  );
}
