import { Suspense } from "react";
import { Users } from "lucide-react";

import {
  PageHeader,
  EmptyState,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getCustomerCohorts,
  type CohortCellRow,
  type CohortMatrix,
} from "@/lib/queries/analytics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retención por cohorte" };

function formatCohortLabel(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

function retentionPct(cell: CohortCellRow | null, base: number): number | null {
  if (!cell || base === 0) return null;
  return (cell.active_customers / base) * 100;
}

function cellBg(pct: number | null): string {
  if (pct == null) return "bg-muted/20";
  if (pct >= 90) return "bg-success/40";
  if (pct >= 70) return "bg-success/25";
  if (pct >= 50) return "bg-info/25";
  if (pct >= 30) return "bg-warning/25";
  if (pct >= 10) return "bg-warning/40";
  return "bg-danger/30";
}

function cellTextColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  return "text-foreground font-semibold";
}

export default function CohortsPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Retención por cohorte"
        subtitle="% de clientes de cada cohort trimestral que siguen activos N trimestres después de su primera compra"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Heatmap de retención</CardTitle>
          <p className="text-xs text-muted-foreground">
            Filas = trimestre de adquisición. Columnas = trimestres desde
            primera compra. Celdas muestran % de clientes activos vs el
            tamaño original del cohort.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded" />
                ))}
              </div>
            }
          >
            <CohortHeatmap />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue por cohort</CardTitle>
          <p className="text-xs text-muted-foreground">
            Mismo grid pero mostrando el revenue total que cada cohort ha
            generado en cada trimestre subsecuente.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded" />
                ))}
              </div>
            }
          >
            <CohortRevenueHeatmap />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function CohortHeatmap() {
  const data = await getCustomerCohorts(36); // 3 años atrás
  if (data.cohorts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin cohorts disponibles"
        description="customer_cohorts no tiene datos en los últimos 3 años."
      />
    );
  }
  return <RetentionTable data={data} />;
}

async function CohortRevenueHeatmap() {
  const data = await getCustomerCohorts(36);
  if (data.cohorts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin cohorts disponibles"
        description="customer_cohorts no tiene datos."
      />
    );
  }
  return <RevenueTable data={data} />;
}

function RetentionTable({ data }: { data: CohortMatrix }) {
  const { cohorts, maxQuarters, matrix, baseSize } = data;
  return (
    <table className="w-full min-w-[640px] border-collapse text-xs">
      <thead>
        <tr>
          <th className="sticky left-0 z-10 border-b bg-background px-3 py-2 text-left font-semibold">
            Cohort
          </th>
          <th className="border-b bg-background px-2 py-2 text-right font-semibold">
            #
          </th>
          {Array.from({ length: maxQuarters + 1 }).map((_, q) => (
            <th
              key={q}
              className="border-b bg-background px-2 py-2 text-center font-semibold"
            >
              Q+{q}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cohorts.map((cohort, i) => (
          <tr key={cohort}>
            <td className="sticky left-0 z-10 border-b bg-background px-3 py-2 font-mono">
              {formatCohortLabel(cohort)}
            </td>
            <td className="border-b px-2 py-2 text-right tabular-nums text-muted-foreground">
              {baseSize[i]}
            </td>
            {Array.from({ length: maxQuarters + 1 }).map((_, q) => {
              const cell = matrix[i][q];
              const pct = retentionPct(cell, baseSize[i]);
              return (
                <td
                  key={q}
                  className={`border-b px-2 py-2 text-center tabular-nums ${cellBg(pct)} ${cellTextColor(pct)}`}
                  title={
                    cell
                      ? `${cell.active_customers}/${baseSize[i]} clientes activos`
                      : "Sin data"
                  }
                >
                  {pct != null ? `${pct.toFixed(0)}%` : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RevenueTable({ data }: { data: CohortMatrix }) {
  const { cohorts, maxQuarters, matrix } = data;
  const formatRev = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toFixed(0);
  };

  // Para colorear revenue: max en toda la matriz como referencia
  let max = 0;
  for (const row of matrix) {
    for (const cell of row) {
      if (cell && cell.cohort_revenue > max) max = cell.cohort_revenue;
    }
  }

  const cellRevBg = (rev: number | null): string => {
    if (rev == null || rev === 0) return "bg-muted/20";
    const ratio = rev / max;
    if (ratio >= 0.6) return "bg-success/40";
    if (ratio >= 0.3) return "bg-success/25";
    if (ratio >= 0.15) return "bg-info/25";
    if (ratio >= 0.05) return "bg-warning/25";
    return "bg-warning/40";
  };

  return (
    <table className="w-full min-w-[640px] border-collapse text-xs">
      <thead>
        <tr>
          <th className="sticky left-0 z-10 border-b bg-background px-3 py-2 text-left font-semibold">
            Cohort
          </th>
          {Array.from({ length: maxQuarters + 1 }).map((_, q) => (
            <th
              key={q}
              className="border-b bg-background px-2 py-2 text-center font-semibold"
            >
              Q+{q}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cohorts.map((cohort, i) => (
          <tr key={cohort}>
            <td className="sticky left-0 z-10 border-b bg-background px-3 py-2 font-mono">
              {formatCohortLabel(cohort)}
            </td>
            {Array.from({ length: maxQuarters + 1 }).map((_, q) => {
              const cell = matrix[i][q];
              const rev = cell?.cohort_revenue ?? null;
              return (
                <td
                  key={q}
                  className={`border-b px-2 py-2 text-center tabular-nums ${cellRevBg(rev)}`}
                  title={
                    cell
                      ? `${cell.active_customers} clientes · ${cell.avg_revenue_per_customer.toFixed(0)} avg`
                      : "Sin data"
                  }
                >
                  {rev != null && rev > 0 ? formatRev(rev) : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
