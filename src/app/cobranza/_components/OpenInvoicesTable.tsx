import { FileSearch } from "lucide-react";

import {
  CompanyLink,
  Currency,
  DataTable,
  DateDisplay,
  type DataTableColumn,
} from "@/components/patterns";
import { cn } from "@/lib/utils";
import { getOpenInvoicesPage, type OpenInvoiceRow } from "@/lib/queries/sp13/cobranza";

interface Props {
  page: number;
  size: number;
  q?: string;
  bucket?: string;
  estadoSat?: string;
}

export async function OpenInvoicesTable({ page, size, q, bucket, estadoSat }: Props) {
  const result = await getOpenInvoicesPage({
    page,
    size,
    q,
    bucket: bucket ? [bucket] : undefined,
    estadoSat: estadoSat ? [estadoSat] : undefined,
    sort: "residual",
    sortDir: "desc",
    facets: {},
  });

  const today = new Date().toISOString().slice(0, 10);

  const cols: DataTableColumn<OpenInvoiceRow>[] = [
    {
      key: "folio",
      header: "Folio / UUID",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.folio ?? "—"}</div>
          {r.satUuid && (
            <div className="truncate text-[10px] text-muted-foreground">
              {r.satUuid.slice(0, 8)}…{r.satUuid.slice(-6)}
            </div>
          )}
        </div>
      ),
      className: "max-w-[200px]",
    },
    {
      key: "company",
      header: "Cliente",
      cell: (r) =>
        r.companyId ? (
          <CompanyLink companyId={r.companyId} name={r.companyName ?? ""} />
        ) : (
          <span>{r.companyName ?? "—"}</span>
        ),
      className: "max-w-[200px]",
    },
    {
      key: "invoice",
      header: "Emisión",
      align: "right",
      sortable: true,
      hideOnMobile: true,
      cell: (r) => <DateDisplay date={r.invoiceDate} />,
    },
    {
      key: "due",
      header: "Vencimiento",
      align: "right",
      sortable: true,
      cell: (r) => {
        const overdue = r.dueDate != null && r.dueDate < today;
        return (
          <span className={cn("tabular-nums", overdue && "font-semibold text-warning")}>
            <DateDisplay date={r.dueDate} />
          </span>
        );
      },
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortable: true,
      hideOnMobile: true,
      cell: (r) => <Currency amount={r.amountTotalMxn} />,
    },
    {
      key: "residual",
      header: "Residual",
      align: "right",
      sortable: true,
      cell: (r) => <Currency amount={r.amountResidualMxn} />,
      summary: (rows) => (
        <Currency amount={rows.reduce((s, r) => s + r.amountResidualMxn, 0)} />
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        data={result.rows}
        columns={cols}
        rowKey={(r) => r.canonicalId}
        emptyState={{
          icon: FileSearch,
          title: "Sin facturas abiertas",
          description: "Ninguna factura coincide con los filtros.",
        }}
        summaryLabel="Totales"
      />
      <p className="text-xs text-muted-foreground">
        Mostrando {result.rows.length} de {result.total}
      </p>
    </div>
  );
}
