import { DriftAlert } from "@/components/patterns";
import {
  getAnomaliesSummary,
  type AnomalyRow,
} from "@/lib/queries/sp13/finanzas";

/* ── Anomalies banner ────────────────────────────────────────────────── */
export async function AnomaliesBanner() {
  const anom = await getAnomaliesSummary();
  const hotCount = anom.criticalCount + anom.highCount;
  if (hotCount === 0) return null;

  const severity: "critical" | "warning" =
    anom.criticalCount > 0 ? "critical" : "warning";

  const title =
    anom.criticalCount > 0
      ? `${anom.criticalCount} anomalía${anom.criticalCount === 1 ? "" : "s"} crítica${anom.criticalCount === 1 ? "" : "s"} · ${anom.highCount} de alta prioridad`
      : `${anom.highCount} anomalía${anom.highCount === 1 ? "" : "s"} de alta prioridad`;

  const description = buildAnomaliesDescription(anom.topItems);

  return (
    <DriftAlert
      severity={severity}
      title={title}
      description={description}
      action={{ label: "Ver todo", href: "/sistema?tab=anomalies" }}
    />
  );
}

function buildAnomaliesDescription(items: AnomalyRow[]): string {
  if (items.length === 0) return "Revisa el panel de anomalías para el detalle.";
  return items
    .slice(0, 2)
    .map((it) => it.description || `${it.anomalyType} · ${it.companyName ?? "—"}`)
    .join(" · ");
}
