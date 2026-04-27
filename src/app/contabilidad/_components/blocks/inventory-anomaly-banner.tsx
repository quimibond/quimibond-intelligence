import { DriftAlert } from "@/components/patterns";
import { formatCurrencyMXN } from "@/lib/formatters";
import { getInventoryAdjustmentsAnomalies } from "@/lib/queries/sp13/finanzas";

const PERIOD_LABELS: Record<string, string> = {
  "01": "ene",
  "02": "feb",
  "03": "mar",
  "04": "abr",
  "05": "may",
  "06": "jun",
  "07": "jul",
  "08": "ago",
  "09": "sep",
  "10": "oct",
  "11": "nov",
  "12": "dic",
};

function formatPeriod(p: string) {
  const [y, m] = p.split("-");
  return `${PERIOD_LABELS[m] ?? m} ${y?.slice(2) ?? ""}`;
}

/**
 * Surface periods where 501.01.02 NET is atypically large vs the trailing
 * 12-month average. Defensive alert so atypical year-end concentrations
 * (like Dec-2025 +$10.54M = 13× rolling avg) don't go unnoticed.
 *
 * Renders nothing when no anomalies — banner pollution avoided.
 */
export async function InventoryAnomalyBanner() {
  const anomalies = await getInventoryAdjustmentsAnomalies({
    accountCodes: ["501.01.02"],
    recentMonths: 6,
    limit: 2,
  });
  if (anomalies.length === 0) return null;

  const top = anomalies[0];
  const severity = top.severity;

  const title =
    `${formatPeriod(top.period)}: ajuste a 501.01.02 de ${formatCurrencyMXN(top.netMxn, { compact: true })}` +
    ` (${top.ratio.toFixed(1)}× sobre el promedio del año previo)`;

  const description =
    anomalies.length > 1
      ? `También atípico: ${anomalies
          .slice(1)
          .map((a) => `${formatPeriod(a.period)} (${formatCurrencyMXN(a.netMxn, { compact: true })}, ${a.ratio.toFixed(1)}×)`)
          .join(" · ")}.` +
        ` Revisa el detalle en "Ajustes de inventario" abajo.`
      : 'Período "atípico" definido como |net| > 3× el promedio rolling 12m. Revisa "Ajustes de inventario" abajo para ver causas (conteo, scrap, manual edits).';

  return (
    <DriftAlert
      severity={severity}
      title={title}
      description={description}
      action={{
        label: "Ver detalle",
        href: `/contabilidad?tab=detalle&period=m:${top.period}#inventory-adjustments`,
      }}
    />
  );
}
