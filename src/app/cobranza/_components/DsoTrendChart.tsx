"use client";

import { Chart } from "@/components/patterns/chart";
import type { DsoMonth } from "@/lib/queries/sp13/cobranza";

interface Props {
  data: DsoMonth[];
  targetDays?: number;
}

const MONTH_LABEL: Record<string, string> = {
  "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Ago",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic",
};

function labelFor(period: string): string {
  const [, m] = period.split("-");
  return MONTH_LABEL[m ?? ""] ?? period;
}

export function DsoTrendChart({ data, targetDays = 45 }: Props) {
  const chartData = data.map((d) => ({
    month: labelFor(d.period),
    period: d.period,
    dso: d.dsoDays,
    target: targetDays,
  }));

  const hasValues = chartData.some((d) => d.dso != null);
  if (!hasValues) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay suficientes pagos en los últimos 12 meses para calcular la tendencia.
      </p>
    );
  }

  return (
    <Chart
      type="line"
      data={chartData}
      xKey="month"
      series={[
        { key: "dso", label: "DSO (días)", color: "neutral" },
        { key: "target", label: `Objetivo ${targetDays}d`, color: "positive" },
      ]}
      yFormatter={(n) => `${Math.round(n)}d`}
      ariaLabel="DSO mensual últimos 12 meses"
      height={260}
    />
  );
}
