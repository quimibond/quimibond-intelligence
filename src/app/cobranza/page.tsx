import { Suspense } from "react";
import {
  AlertTriangle,
  Calendar,
  FileText,
  TrendingDown,
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
  StatusBadge,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getArAging,
  getOverdueInvoices,
  type OverdueInvoice,
} from "@/lib/queries/invoices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cobranza" };

export default function CobranzaPage() {
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Cobranza"
        subtitle="Cartera vencida y buckets de aging"
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
  const icons = [Calendar, Calendar, AlertTriangle, AlertTriangle, TrendingDown];
  const tones: Array<"info" | "warning" | "warning" | "danger" | "danger"> = [
    "info",
    "warning",
    "warning",
    "danger",
    "danger",
  ];
  return (
    <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
      {buckets.map((b, i) => (
        <KpiCard
          key={b.bucket}
          title={`${b.bucket} días`}
          value={b.amount_mxn}
          format="currency"
          compact
          icon={icons[i] ?? Calendar}
          subtitle={`${b.count} facturas`}
          tone={tones[i]}
          size="sm"
        />
      ))}
    </StatGrid>
  );
}

const columns: DataTableColumn<OverdueInvoice>[] = [
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
    header: "Días vencido",
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        {r.days_overdue ?? 0}
      </span>
    ),
    align: "right",
  },
  {
    key: "due",
    header: "Vence",
    cell: (r) => <DateDisplay date={r.due_date} />,
    hideOnMobile: true,
  },
  {
    key: "salesperson",
    header: "Vendedor",
    cell: (r) => r.salesperson_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => <StatusBadge status="overdue" />,
  },
];

async function OverdueTable() {
  const rows = await getOverdueInvoices(50);
  return (
    <DataTable
      data={rows}
      columns={columns}
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
              label: "Vendedor",
              value: r.salesperson_name ?? "—",
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
