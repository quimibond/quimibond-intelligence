import { Suspense } from "react";
import { Building2 } from "lucide-react";

import {
  PageHeader,
  DataTable,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  TrendIndicator,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCompaniesList,
  type CompanyListRow,
} from "@/lib/queries/companies";

export const dynamic = "force-dynamic";
export const metadata = { title: "Empresas" };

const statusVariant: Record<
  string,
  "success" | "warning" | "critical" | "secondary"
> = {
  active: "success",
  cooling: "warning",
  at_risk: "critical",
  churned: "secondary",
};

const statusLabel: Record<string, string> = {
  active: "Activo",
  cooling: "Enfriando",
  at_risk: "En riesgo",
  churned: "Perdido",
};

export default function CompaniesPage() {
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Empresas"
        subtitle="Portfolio de clientes con riesgo, revenue y tendencia"
      />

      <div className="flex flex-wrap gap-2 text-xs">
        <a
          href="/companies/at-risk"
          className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-medium hover:bg-muted"
        >
          Clientes en riesgo (reactivación)
        </a>
      </div>

      <Suspense
        fallback={
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        }
      >
        <CompaniesTable />
      </Suspense>
    </div>
  );
}

const columns: DataTableColumn<CompanyListRow>[] = [
  {
    key: "company",
    header: "Empresa",
    cell: (r) => (
      <CompanyLink
        companyId={r.company_id}
        name={r.name}
        tier={(r.pareto_class as "A" | "B" | "C") ?? undefined}
        truncate
      />
    ),
  },
  {
    key: "status",
    header: "Estado",
    cell: (r) =>
      r.customer_status ? (
        <Badge
          variant={statusVariant[r.customer_status] ?? "secondary"}
          className="uppercase text-[10px]"
        >
          {statusLabel[r.customer_status] ?? r.customer_status}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    hideOnMobile: true,
  },
  {
    key: "revenue",
    header: "Revenue total",
    cell: (r) => <Currency amount={r.total_revenue} compact />,
    align: "right",
  },
  {
    key: "revenue_90d",
    header: "Revenue 90d",
    cell: (r) => <Currency amount={r.revenue_90d} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "trend",
    header: "Tendencia",
    cell: (r) =>
      r.trend_pct !== 0 ? (
        <TrendIndicator value={r.trend_pct} good="up" />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
  },
  {
    key: "overdue",
    header: "Vencido",
    cell: (r) =>
      r.overdue_amount > 0 ? (
        <span className="text-danger">
          <Currency amount={r.overdue_amount} compact />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "last_order",
    header: "Último pedido",
    cell: (r) => <DateDisplay date={r.last_order_date} relative />,
    hideOnMobile: true,
  },
];

async function CompaniesTable() {
  const rows = await getCompaniesList(150);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Sin empresas"
        description="No hay empresas con revenue registrado."
      />
    );
  }

  return (
    <>
      <Card>
        <CardContent className="grid grid-cols-3 gap-3 py-3 text-center sm:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total empresas
            </div>
            <div className="text-lg font-bold tabular-nums">{rows.length}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Pareto A
            </div>
            <div className="text-lg font-bold tabular-nums text-success">
              {rows.filter((r) => r.pareto_class === "A").length}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              En riesgo
            </div>
            <div className="text-lg font-bold tabular-nums text-danger">
              {rows.filter((r) => r.customer_status === "at_risk").length}
            </div>
          </div>
          <div className="hidden sm:block">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Con vencido
            </div>
            <div className="text-lg font-bold tabular-nums text-warning">
              {rows.filter((r) => r.overdue_amount > 0).length}
            </div>
          </div>
        </CardContent>
      </Card>

      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => String(r.company_id)}
        mobileCard={(r) => (
          <MobileCard
            title={
              <CompanyLink
                companyId={r.company_id}
                name={r.name}
                tier={(r.pareto_class as "A" | "B" | "C") ?? undefined}
                truncate
              />
            }
            subtitle={
              r.customer_status
                ? statusLabel[r.customer_status] ?? r.customer_status
                : undefined
            }
            badge={
              r.overdue_amount > 0 ? (
                <span className="rounded bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger-foreground">
                  <Currency amount={r.overdue_amount} compact />
                </span>
              ) : undefined
            }
            fields={[
              {
                label: "Revenue",
                value: <Currency amount={r.total_revenue} compact />,
              },
              {
                label: "90d",
                value: <Currency amount={r.revenue_90d} compact />,
              },
              {
                label: "Trend",
                value:
                  r.trend_pct !== 0 ? (
                    <TrendIndicator value={r.trend_pct} good="up" />
                  ) : (
                    "—"
                  ),
              },
              {
                label: "Último",
                value: <DateDisplay date={r.last_order_date} relative />,
              },
            ]}
          />
        )}
      />
    </>
  );
}
