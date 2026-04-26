import { Suspense } from "react";
import { Banknote } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import {
  DataTable,
  Currency,
  DateDisplay,
  StatusBadge,
  EmptyState,
  MobileCard,
  QuestionSection,
  type DataTableColumn,
} from "@/components/patterns";
import {
  getCompanyPayments,
  type CompanyPaymentRow,
} from "@/lib/queries/_shared/payments";
import type { CompanyDetail } from "@/lib/queries/_shared/companies";

interface Props {
  company: CompanyDetail;
}

// ──────────────────────────────────────────────────────────────────────────
// Column definitions
// ──────────────────────────────────────────────────────────────────────────
const columns: DataTableColumn<CompanyPaymentRow>[] = [
  {
    key: "payment_date",
    header: "Fecha",
    sortable: false,
    cell: (r) => <DateDisplay date={r.payment_date} />,
  },
  {
    key: "payment_type",
    header: "Tipo",
    cell: (r) => {
      const type = r.payment_type;
      if (type === "inbound") return <span className="text-success text-xs font-medium">Cobro</span>;
      if (type === "outbound") return <span className="text-danger text-xs font-medium">Pago</span>;
      return <span className="text-xs text-muted-foreground">{type ?? "—"}</span>;
    },
  },
  {
    key: "amount_mxn",
    header: "Monto MXN",
    align: "right",
    cell: (r) => <Currency amount={r.amount_mxn ?? r.amount} />,
  },
  {
    key: "currency",
    header: "Moneda",
    cell: (r) => (
      <span className="font-mono text-xs">{r.currency ?? "MXN"}</span>
    ),
    hideOnMobile: true,
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => (
      <StatusBadge status={(r.state ?? "pending") as "paid"} />
    ),
  },
  {
    key: "name",
    header: "Referencia",
    cell: (r) => (
      <span className="font-mono text-xs text-muted-foreground">{r.name ?? "—"}</span>
    ),
    hideOnMobile: true,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Async data fetcher (server component)
// ──────────────────────────────────────────────────────────────────────────
async function PaymentsTable({ companyId }: { companyId: number }) {
  const rows = await getCompanyPayments(companyId, 100);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Banknote}
        title="Sin pagos registrados"
        description="Esta empresa no tiene pagos sincronizados desde Odoo."
        compact
      />
    );
  }

  return (
    <DataTable
      data={rows}
      columns={columns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={r.name ?? "—"}
          subtitle={<DateDisplay date={r.payment_date} />}
          badge={
            <StatusBadge status={(r.state ?? "pending") as "paid"} />
          }
          fields={[
            {
              label: "Tipo",
              value:
                r.payment_type === "inbound"
                  ? "Cobro"
                  : r.payment_type === "outbound"
                    ? "Pago"
                    : (r.payment_type ?? "—"),
            },
            {
              label: "Monto",
              value: <Currency amount={r.amount_mxn ?? r.amount} />,
            },
            { label: "Moneda", value: r.currency ?? "MXN" },
          ]}
        />
      )}
      emptyState={{
        icon: Banknote,
        title: "Sin pagos registrados",
        description: "Esta empresa no tiene pagos sincronizados desde Odoo.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pagos tab — main export
// ──────────────────────────────────────────────────────────────────────────
export function PagosTab({ company }: Props) {
  return (
    <div className="space-y-6">
      <QuestionSection
        id="company-payments"
        question="¿Cuándo y cuánto pagó (o cobró)?"
        subtext="Historial de cobros y pagos sincronizados desde Odoo: fecha, tipo, monto, estado, referencia."
        actions={<DataSourceBadge source="odoo" refresh="1h" />}
      >
        <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
          <PaymentsTable companyId={company.id} />
        </Suspense>
      </QuestionSection>
    </div>
  );
}
