import { ShieldAlert } from "lucide-react";
import {
  DataView,
  DataTablePagination,
  DateDisplay,
  CompanyLink,
  MobileCard,
  makeSortHref,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import {
  getComplementosMissingPage,
  type ComplementoMissingRow,
} from "@/lib/queries/unified/payments";
import { parseTableParams, parseVisibleKeys } from "@/lib/queries/_shared/table-params";
import { type YearValue } from "@/lib/queries/_shared/year-filter";

type SearchParams = Record<string, string | string[] | undefined>;

interface ComplementosMissingTableProps {
  year?: YearValue;
  searchParams: SearchParams;
  pathname: string;
}

function severityVariant(s: string | null): "critical" | "warning" | "info" | "secondary" {
  if (!s) return "secondary";
  if (s === "critical") return "critical";
  if (s === "high") return "warning";
  if (s === "medium") return "info";
  return "secondary";
}

function severityLabel(s: string | null): string {
  if (!s) return "—";
  const map: Record<string, string> = {
    critical: "Crítico",
    high: "Alto",
    medium: "Medio",
    low: "Bajo",
  };
  return map[s] ?? s;
}

const paramPrefix = "comp_";

const columns: DataTableColumn<ComplementoMissingRow>[] = [
  {
    key: "detected_at",
    header: "Detectado",
    alwaysVisible: true,
    sortable: true,
    cell: (r) => <DateDisplay date={r.detected_at} />,
  },
  {
    key: "company",
    header: "Empresa",
    cell: (r) =>
      r.company_id ? (
        <CompanyLink companyId={r.company_id} name={null} truncate />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "uuid",
    header: "UUID SAT",
    cell: (r) =>
      r.uuid_sat ? (
        <span className="font-mono text-[10px]">{r.uuid_sat.slice(0, 12)}…</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    hideOnMobile: true,
  },
  {
    key: "severity",
    header: "Severidad",
    cell: (r) => (
      <Badge variant={severityVariant(r.severity)}>
        {severityLabel(r.severity)}
      </Badge>
    ),
  },
  {
    key: "description",
    header: "Descripción",
    cell: (r) => (
      <span className="text-xs text-muted-foreground line-clamp-1">
        {r.description ?? "—"}
      </span>
    ),
    hideOnMobile: true,
  },
  {
    key: "canonical_id",
    header: "ID canónico",
    defaultHidden: true,
    cell: (r) => (
      <span className="font-mono text-[10px]">{r.canonical_id ?? "—"}</span>
    ),
  },
];

export async function ComplementosMissingTable({
  year,
  searchParams,
  pathname,
}: ComplementosMissingTableProps) {
  const params = parseTableParams(searchParams, {
    prefix: paramPrefix,
    defaultSize: 25,
    defaultSort: "-detected_at",
  });

  const { rows, total, page, pageSize } = await getComplementosMissingPage({
    ...params,
    year,
  });

  const visibleKeys = parseVisibleKeys(searchParams, paramPrefix);
  const sortHref = makeSortHref({ pathname, searchParams, paramPrefix });

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-base font-semibold">Complementos SAT faltantes</h3>
        {total > 0 && (
          <Badge variant="warning">{total.toLocaleString("es-MX")} abiertos</Badge>
        )}
      </div>
      <DataView
        data={rows}
        columns={columns}
        rowKey={(r) => r.issue_id}
        sort={params.sort ? { key: params.sort, dir: params.sortDir } : null}
        sortHref={sortHref}
        visibleKeys={visibleKeys}
        stickyHeader
        mobileCard={(r) => (
          <MobileCard
            title={<DateDisplay date={r.detected_at} />}
            badge={
              <Badge variant={severityVariant(r.severity)}>
                {severityLabel(r.severity)}
              </Badge>
            }
            fields={[
              {
                label: "UUID SAT",
                value: r.uuid_sat ? `${r.uuid_sat.slice(0, 12)}…` : "—",
              },
              {
                label: "Descripción",
                value: r.description ?? "—",
                className: "col-span-2",
              },
            ]}
          />
        )}
        emptyState={{
          icon: ShieldAlert,
          title: "Sin complementos faltantes",
          description: "Todos los pagos tienen complemento SAT registrado.",
        }}
      />
      <DataTablePagination
        paramPrefix={paramPrefix}
        total={total}
        page={page}
        pageSize={pageSize}
        unit="issues"
      />
    </div>
  );
}
