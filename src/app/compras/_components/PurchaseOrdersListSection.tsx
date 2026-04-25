import Link from "next/link";
import { FileBox } from "lucide-react";
import {
  QuestionSection,
  DataTable,
  CompanyLink,
  Currency,
  DateDisplay,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import type {
  RecentPurchaseOrder,
  RecentPurchaseOrderPage,
} from "@/lib/queries/sp13/compras";
import {
  ComprasFilterBar,
  type ComprasFilterBarParams,
} from "./ComprasFilterBar";

interface Props {
  result: RecentPurchaseOrderPage & { page: number; limit: number };
  params: ComprasFilterBarParams;
  buyerOptions: string[];
  buildPageHref: (page: number) => string;
}

const stateVariant: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "danger"
> = {
  draft: "secondary",
  sent: "secondary",
  "to approve": "warning",
  purchase: "default",
  done: "success",
  cancel: "danger",
};

const stateLabel: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviada",
  "to approve": "Por aprobar",
  purchase: "Confirmada",
  done: "Cerrada",
  cancel: "Cancelada",
};

const columns: DataTableColumn<RecentPurchaseOrder>[] = [
  {
    key: "name",
    header: "OC",
    alwaysVisible: true,
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "supplier",
    header: "Proveedor",
    cell: (r) =>
      r.canonical_company_id != null ? (
        <CompanyLink
          companyId={r.canonical_company_id}
          name={r.company_name}
          truncate
        />
      ) : (
        <span className="truncate text-muted-foreground">—</span>
      ),
  },
  {
    key: "buyer",
    header: "Comprador",
    hideOnMobile: true,
    cell: (r) => (
      <span className="truncate text-xs text-muted-foreground">
        {r.buyer_name ?? "—"}
      </span>
    ),
  },
  {
    key: "amount",
    header: "Monto",
    align: "right",
    cell: (r) => <Currency amount={r.amount_total_mxn} compact />,
  },
  {
    key: "date",
    header: "Fecha",
    align: "right",
    hideOnMobile: true,
    cell: (r) =>
      r.date_order ? (
        <DateDisplay date={r.date_order} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "state",
    header: "Estado",
    align: "center",
    cell: (r) =>
      r.state ? (
        <Badge variant={stateVariant[r.state] ?? "secondary"} className="h-5 text-[10px]">
          {stateLabel[r.state] ?? r.state}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export function PurchaseOrdersListSection({
  result,
  params,
  buyerOptions,
  buildPageHref,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
  const startIdx = (result.page - 1) * result.limit + 1;
  const endIdx = Math.min(result.page * result.limit, result.total);

  return (
    <QuestionSection
      id="orders"
      question="Todas las órdenes de compra"
      subtext={`${result.total.toLocaleString("es-MX")} órdenes · página ${result.page} de ${totalPages}`}
    >
      <ComprasFilterBar params={params} buyerOptions={buyerOptions} />
      <DataTable
        data={result.rows}
        columns={columns}
        rowKey={(r) => r.canonical_id}
        emptyState={{
          icon: FileBox,
          title: "Sin resultados",
          description: "Ajusta los filtros o limpia la búsqueda.",
        }}
      />
      {totalPages > 1 && (
        <nav
          aria-label="Paginación"
          className="flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground"
        >
          <span>
            {startIdx}–{endIdx} de {result.total.toLocaleString("es-MX")}
          </span>
          <div className="flex items-center gap-2">
            <PageLink
              href={buildPageHref(Math.max(1, result.page - 1))}
              disabled={result.page <= 1}
              label="← Anterior"
            />
            <PageLink
              href={buildPageHref(Math.min(totalPages, result.page + 1))}
              disabled={result.page >= totalPages}
              label="Siguiente →"
            />
          </div>
        </nav>
      )}
    </QuestionSection>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-8 items-center rounded border border-border px-3 text-xs text-muted-foreground opacity-50">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center rounded border border-border px-3 text-xs font-medium hover:bg-muted"
    >
      {label}
    </Link>
  );
}
