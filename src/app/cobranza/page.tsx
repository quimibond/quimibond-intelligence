import { Suspense } from "react";
import {
  AlertTriangle,
  Calendar,
  FileText,
  TrendingDown,
  Users,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getArAging,
  getCompanyAging,
  getOverdueInvoices,
  type CompanyAgingRow,
  type OverdueInvoice,
} from "@/lib/queries/invoices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cobranza" };

export default function CobranzaPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Cobranza"
        subtitle="Cartera vencida por bucket y por cliente"
      />

      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <AgingKpis />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Clientes con cartera vencida
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <CompanyAgingTable />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facturas vencidas</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <OverdueTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function AgingKpis() {
  const buckets = await getArAging();
  const iconMap: Record<string, typeof Calendar> = {
    "1-30": Calendar,
    "31-60": Calendar,
    "61-90": AlertTriangle,
    "91-120": AlertTriangle,
    "120+": TrendingDown,
  };
  const toneMap: Record<string, "info" | "warning" | "danger"> = {
    "1-30": "info",
    "31-60": "warning",
    "61-90": "warning",
    "91-120": "danger",
    "120+": "danger",
  };
  return (
    <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
      {buckets.map((b) => (
        <KpiCard
          key={b.bucket}
          title={`${b.bucket} días`}
          value={b.amount_mxn}
          format="currency"
          compact
          icon={iconMap[b.bucket] ?? Calendar}
          subtitle={`${b.count} facturas`}
          tone={toneMap[b.bucket] ?? "info"}
          size="sm"
        />
      ))}
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Company aging (from cash_flow_aging view)
// ──────────────────────────────────────────────────────────────────────────
const companyColumns: DataTableColumn<CompanyAgingRow>[] = [
  {
    key: "company",
    header: "Cliente",
    cell: (r) => (
      <CompanyLink
        companyId={r.company_id}
        name={r.company_name}
        tier={(r.tier as "A" | "B" | "C") ?? undefined}
        truncate
      />
    ),
  },
  {
    key: "1_30",
    header: "1-30",
    cell: (r) => <Currency amount={r.overdue_1_30} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "31_60",
    header: "31-60",
    cell: (r) => <Currency amount={r.overdue_31_60} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "61_90",
    header: "61-90",
    cell: (r) => <Currency amount={r.overdue_61_90} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "90plus",
    header: "90+",
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        <Currency amount={r.overdue_90plus} compact />
      </span>
    ),
    align: "right",
  },
  {
    key: "total",
    header: "Total",
    cell: (r) => (
      <span className="font-bold tabular-nums">
        <Currency amount={r.total_receivable} compact />
      </span>
    ),
    align: "right",
  },
];

async function CompanyAgingTable() {
  const rows = await getCompanyAging(50);
  const overdueOnly = rows.filter(
    (r) =>
      r.overdue_1_30 +
        r.overdue_31_60 +
        r.overdue_61_90 +
        r.overdue_90plus >
      0
  );
  return (
    <DataTable
      data={overdueOnly}
      columns={companyColumns}
      rowKey={(r) => String(r.company_id)}
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name}
              tier={(r.tier as "A" | "B" | "C") ?? undefined}
              truncate
            />
          }
          badge={
            <span className="rounded bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger-foreground">
              <Currency amount={r.total_receivable} compact />
            </span>
          }
          fields={[
            {
              label: "1-30",
              value: <Currency amount={r.overdue_1_30} compact />,
            },
            {
              label: "31-60",
              value: <Currency amount={r.overdue_31_60} compact />,
            },
            {
              label: "61-90",
              value: <Currency amount={r.overdue_61_90} compact />,
            },
            {
              label: "90+",
              value: <Currency amount={r.overdue_90plus} compact />,
              className: "text-danger",
            },
          ]}
        />
      )}
      emptyState={{
        icon: Users,
        title: "Sin clientes con cartera vencida",
        description: "Todos los clientes están al corriente.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Overdue invoices (from ar_aging_detail view)
// ──────────────────────────────────────────────────────────────────────────
const invoiceColumns: DataTableColumn<OverdueInvoice>[] = [
  {
    key: "name",
    header: "Factura",
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "company",
    header: "Cliente",
    cell: (r) =>
      r.company_id ? (
        <CompanyLink
          companyId={r.company_id}
          name={r.company_name}
          truncate
        />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "residual",
    header: "Saldo",
    cell: (r) => <Currency amount={r.amount_residual_mxn} />,
    align: "right",
  },
  {
    key: "days",
    header: "Días",
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        {r.days_overdue ?? 0}
      </span>
    ),
    align: "right",
  },
  {
    key: "bucket",
    header: "Bucket",
    cell: (r) => (
      <span className="text-xs uppercase">{r.aging_bucket ?? "—"}</span>
    ),
    hideOnMobile: true,
  },
  {
    key: "due",
    header: "Vence",
    cell: (r) => <DateDisplay date={r.due_date} />,
    hideOnMobile: true,
  },
];

async function OverdueTable() {
  const rows = await getOverdueInvoices(50);
  return (
    <DataTable
      data={rows}
      columns={invoiceColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={
            r.company_id ? (
              <CompanyLink
                companyId={r.company_id}
                name={r.company_name}
                truncate
              />
            ) : (
              (r.company_name ?? "—")
            )
          }
          subtitle={r.name ?? undefined}
          badge={
            <span className="rounded bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger-foreground">
              {r.days_overdue ?? 0}d
            </span>
          }
          fields={[
            {
              label: "Saldo",
              value: <Currency amount={r.amount_residual_mxn} />,
            },
            { label: "Vence", value: <DateDisplay date={r.due_date} /> },
            {
              label: "Bucket",
              value: r.aging_bucket ?? "—",
              className: "col-span-2",
            },
          ]}
        />
      )}
      emptyState={{
        icon: FileText,
        title: "Sin cartera vencida",
        description: "Todas las facturas están al corriente.",
      }}
    />
  );
}
