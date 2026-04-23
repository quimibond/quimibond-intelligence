import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/patterns/section-header";
import { MetricRow } from "@/components/patterns/metric-row";
import { AgingBuckets, type AgingData } from "@/components/patterns/aging-buckets";
import { Chart } from "@/components/patterns/chart";
import { cn } from "@/lib/utils";

export interface FinancieroTabProps {
  detail: {
    aging?: AgingData | null;
    revenueTrend?: Array<{ month_start: string; total_mxn: number }> | null;
    overdue_amount_mxn?: number | null;
    lifetime_value_mxn?: number | null;
    revenue_90d_mxn?: number | null;
  };
}

function fmtMxn(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

function agingTotal(a?: AgingData | null): number {
  if (!a) return 0;
  return a.current + a.d1_30 + a.d31_60 + a.d61_90 + a.d90_plus;
}

export function FinancieroTab({ detail }: FinancieroTabProps) {
  const { aging, revenueTrend, overdue_amount_mxn, lifetime_value_mxn, revenue_90d_mxn } = detail;

  return (
    <div className="space-y-6">
      {aging && agingTotal(aging) > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Cartera abierta" />
          <Card className="p-4">
            <AgingBuckets data={aging} ariaLabel="Aging de cartera de este cliente" />
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeader title="Ingresos de este cliente (12 meses)" />
        <Card className="p-4">
          {revenueTrend && revenueTrend.length > 1 ? (
            <Chart
              type="area"
              data={revenueTrend}
              xKey="month_start"
              series={[{ key: "total_mxn", label: "Ingresos", color: "positive" }]}
              ariaLabel="Ingresos mensuales 12 meses de este cliente"
              height={200}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin datos de ingresos en los últimos 12 meses.
            </p>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader title="Cashflow snapshot" />
        <Card className="p-4">
          <dl className="space-y-2">
            <MetricRow
              label="Cartera vencida"
              value={
                <span
                  className={cn(
                    "tabular-nums",
                    (overdue_amount_mxn ?? 0) > 0 && "text-status-critical font-semibold"
                  )}
                >
                  {fmtMxn(overdue_amount_mxn)}
                </span>
              }
            />
            <MetricRow
              label="LTV"
              value={<span className="tabular-nums">{fmtMxn(lifetime_value_mxn)}</span>}
            />
            <MetricRow
              label="Revenue últimos 90 días"
              value={<span className="tabular-nums">{fmtMxn(revenue_90d_mxn)}</span>}
            />
          </dl>
        </Card>
      </section>
    </div>
  );
}
