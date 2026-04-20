import { FileText } from "lucide-react";
import {
  DataView,
  DataTablePagination,
  DateDisplay,
  Currency,
  MobileCard,
  makeSortHref,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import {
  getPaymentsPage,
  type PaymentRow,
  type PaymentDirection,
} from "@/lib/queries/unified/payments";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/_shared/table-params";
import { type YearValue } from "@/lib/queries/_shared/year-filter";

type SearchParams = Record<string, string | string[] | undefined>;

interface PagosTableProps {
  direction: PaymentDirection;
  year?: YearValue;
  searchParams: SearchParams;
  paramPrefix: string;
  title: string;
  pathname: string;
}

function matchStatusLabel(s: string | null): string {
  if (!s) return "—";
  const map: Record<string, string> = {
    match_uuid: "UUID",
    match_composite: "Compuesto",
    odoo_only: "Solo Odoo",
    sat_only: "Solo SAT",
    unmatched: "Sin match",
  };
  return map[s] ?? s;
}

function matchStatusVariant(s: string | null): "success" | "info" | "warning" | "secondary" {
  if (!s) return "secondary";
  if (s === "match_uuid") return "success";
  if (s === "match_composite") return "info";
  if (s === "odoo_only") return "warning";
  return "secondary";
}

const columns: DataTableColumn<PaymentRow>[] = [
  {
    key: "fecha_pago",
    header: "Fecha",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <DateDisplay date={r.fecha_pago} />,
  },
  {
    key: "monto",
    header: "Monto",
    alwaysVisible: true,
    sortable: true,
    align: "right",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        <Currency amount={r.monto} />
      </span>
    ),
    summary: (rows) => (
      <span className="font-bold tabular-nums">
        <Currency
          amount={rows.reduce((s, r) => s + (Number(r.monto) || 0), 0)}
          compact
        />
      </span>
    ),
  },
  {
    key: "forma_pago",
    header: "Forma pago",
    cell: (r) => (
      <span className="text-xs">{r.forma_pago_p ?? r.payment_method ?? "—"}</span>
    ),
    hideOnMobile: true,
  },
  {
    key: "journal",
    header: "Banco",
    cell: (r) => <span className="text-xs">{r.journal_name ?? "—"}</span>,
    hideOnMobile: true,
  },
  {
    key: "moneda",
    header: "Moneda",
    defaultHidden: true,
    cell: (r) => <span className="text-xs">{r.moneda_p ?? r.odoo_currency ?? "MXN"}</span>,
  },
  {
    key: "match",
    header: "Match",
    cell: (r) => (
      <Badge variant={matchStatusVariant(r.match_status)}>
        {matchStatusLabel(r.match_status)}
      </Badge>
    ),
    hideOnMobile: true,
  },
  {
    key: "uuid",
    header: "UUID complemento",
    defaultHidden: true,
    cell: (r) =>
      r.uuid_complemento ? (
        <span className="font-mono text-[10px] text-muted-foreground">{r.uuid_complemento.slice(0, 8)}…</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "ref",
    header: "Referencia Odoo",
    defaultHidden: true,
    cell: (r) => <span className="text-xs font-mono">{r.odoo_ref ?? "—"}</span>,
  },
];

export async function PagosTable({
  direction,
  year,
  searchParams,
  paramPrefix,
  title,
  pathname,
}: PagosTableProps) {
  const params = parseTableParams(searchParams, {
    prefix: paramPrefix,
    defaultSize: 20,
    defaultSort: "-fecha_pago",
  });

  const { rows, total, page, pageSize } = await getPaymentsPage({
    ...params,
    direction,
    year,
  });

  const visibleKeys = parseVisibleKeys(searchParams, paramPrefix);
  const sortHref = makeSortHref({ pathname, searchParams, paramPrefix });

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">{title}</h3>
      <DataView
        data={rows}
        columns={columns}
        rowKey={(r) => r.canonical_payment_id}
        sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        mobileCard={(r) => (
          <MobileCard
            title={<DateDisplay date={r.fecha_pago} />}
            badge={
              <Badge variant={matchStatusVariant(r.match_status)}>
                {matchStatusLabel(r.match_status)}
              </Badge>
            }
            fields={[
              {
                label: "Monto",
                value: <Currency amount={r.monto} compact />,
              },
              {
                label: "Banco",
                value: r.journal_name ?? "—",
              },
              {
                label: "Forma pago",
                value: r.forma_pago_p ?? r.payment_method ?? "—",
              },
            ]}
          />
        )}
        emptyState={{
          icon: FileText,
          title: `Sin pagos ${direction === "received" ? "recibidos" : "enviados"}`,
          description: "No hay pagos en el período seleccionado.",
        }}
      />
      <DataTablePagination
        paramPrefix={paramPrefix}
        total={total}
        page={page}
        pageSize={pageSize}
        unit="pagos"
      />
    </div>
  );
}
