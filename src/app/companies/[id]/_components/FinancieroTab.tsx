import { Suspense } from "react";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  DataTablePagination,
  TableViewOptions,
  TableExportButton,
  MobileCard,
  Currency,
  DateDisplay,
  StatusBadge,
  makeSortHref,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import {
  getCompanyInvoicesPage,
  type CompanyInvoiceRow,
} from "@/lib/queries/companies";
import { getCustomer360 } from "@/lib/queries/customer-360";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/table-params";
import type { CompanyDetail } from "@/lib/queries/companies";

type SearchParams = Record<string, string | string[] | undefined>;

interface Props {
  company: CompanyDetail;
  searchParams: SearchParams;
}

// ──────────────────────────────────────────────────────────────────────────
// LTV + churn summary card
// ──────────────────────────────────────────────────────────────────────────
async function LtvSection({ companyId }: { companyId: number }) {
  const c360 = await getCustomer360(companyId);
  if (!c360) return null;
  if (!c360.ltv_mxn && !c360.churn_risk_score) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">LTV & Riesgo</CardTitle>
          <DataSourceBadge source="unified" refresh="15min" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {c360.ltv_mxn != null && (
          <div className="flex items-center justify-between py-1.5 border-b last:border-0">
            <span className="text-muted-foreground">LTV estimado</span>
            <Currency amount={c360.ltv_mxn} />
          </div>
        )}
        {c360.churn_risk_score != null && (
          <div className="flex items-center justify-between py-1.5 border-b last:border-0">
            <span className="text-muted-foreground">Churn risk score</span>
            <span
              className={`tabular-nums font-medium ${
                c360.churn_risk_score >= 0.7
                  ? "text-danger-foreground"
                  : c360.churn_risk_score >= 0.4
                    ? "text-warning-foreground"
                    : "text-success-foreground"
              }`}
            >
              {(c360.churn_risk_score * 100).toFixed(0)}%
            </span>
          </div>
        )}
        {c360.overdue_amount != null && c360.overdue_amount > 0 && (
          <div className="flex items-center justify-between py-1.5 last:border-0">
            <span className="text-muted-foreground">Cartera vencida</span>
            <span className="tabular-nums font-medium text-danger-foreground">
              <Currency amount={c360.overdue_amount} />
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Invoices section
// ──────────────────────────────────────────────────────────────────────────
const invoiceColumns: DataTableColumn<CompanyInvoiceRow>[] = [
  {
    key: "name",
    header: "Factura",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "date",
    header: "Fecha",
    sortable: true,
    cell: (r) => <DateDisplay date={r.invoice_date} />,
    hideOnMobile: true,
  },
  {
    key: "due",
    header: "Vence",
    sortable: true,
    cell: (r) => <DateDisplay date={r.due_date} />,
  },
  {
    key: "total",
    header: "Total",
    sortable: true,
    cell: (r) => <Currency amount={r.amount_total_mxn} />,
    align: "right",
  },
  {
    key: "residual",
    header: "Saldo",
    sortable: true,
    cell: (r) =>
      r.amount_residual_mxn && r.amount_residual_mxn > 0 ? (
        <Currency amount={r.amount_residual_mxn} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "days",
    header: "Días",
    defaultHidden: true,
    sortable: true,
    cell: (r) =>
      r.days_overdue && r.days_overdue > 0 ? (
        <span className="font-semibold text-danger tabular-nums">
          {r.days_overdue}
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => (
      <StatusBadge status={(r.payment_state ?? "pending") as "paid"} />
    ),
  },
];

const companyInvoicesViewColumns = [
  { key: "name", label: "Factura", alwaysVisible: true },
  { key: "date", label: "Fecha" },
  { key: "due", label: "Vence" },
  { key: "total", label: "Total" },
  { key: "residual", label: "Saldo" },
  { key: "days", label: "Días vencido", defaultHidden: true },
  { key: "state", label: "Estado" },
];

async function InvoicesSection({
  companyId,
  searchParams,
  companyName,
}: {
  companyId: number;
  searchParams: SearchParams;
  companyName: string;
}) {
  const params = parseTableParams(searchParams, {
    prefix: "ci_",
    defaultSize: 25,
    defaultSort: "-date",
  });
  const { rows, total } = await getCompanyInvoicesPage(companyId, params);
  const visibleKeys = parseVisibleKeys(searchParams, "ci_");
  const sortHref = makeSortHref({
    pathname: `/companies/${companyId}`,
    searchParams,
    paramPrefix: "ci_",
  });
  return (
    <div className="space-y-3">
      <DataTable
        data={rows}
        columns={invoiceColumns}
        rowKey={(r) => String(r.id)}
        sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        mobileCard={(r) => (
          <MobileCard
            title={r.name ?? "—"}
            subtitle={<DateDisplay date={r.invoice_date} />}
            badge={
              <StatusBadge status={(r.payment_state ?? "pending") as "paid"} />
            }
            fields={[
              {
                label: "Total",
                value: <Currency amount={r.amount_total_mxn} />,
              },
              {
                label: "Saldo",
                value: <Currency amount={r.amount_residual_mxn} />,
              },
              { label: "Vence", value: <DateDisplay date={r.due_date} /> },
              {
                label: "Días vencido",
                value:
                  r.days_overdue && r.days_overdue > 0 ? r.days_overdue : "—",
                className:
                  r.days_overdue && r.days_overdue > 0 ? "text-danger" : "",
              },
            ]}
          />
        )}
        emptyState={{
          icon: FileText,
          title: "Sin facturas",
          description: "No hay facturas registradas para esta empresa.",
        }}
      />
      <DataTablePagination
        paramPrefix="ci_"
        total={total}
        page={params.page}
        pageSize={params.size}
        unit="facturas"
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Financiero tab — main export
// ──────────────────────────────────────────────────────────────────────────
export function FinancieroTab({ company, searchParams }: Props) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Skeleton className="h-28 rounded-xl" />}>
        <LtvSection companyId={company.id} />
      </Suspense>

      <Card data-table-export-root>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Facturas</CardTitle>
            <p className="text-xs text-muted-foreground">
              ¿Qué me debe este cliente y cuánto lleva vencido?
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DataSourceBadge source="unified" refresh="15min" />
            <TableViewOptions
              paramPrefix="ci_"
              columns={companyInvoicesViewColumns}
            />
            <TableExportButton filename={`${company.name}-invoices`} />
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
            <InvoicesSection
              companyId={company.id}
              searchParams={searchParams}
              companyName={company.name}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
