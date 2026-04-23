import Link from "next/link";
import { Building2 } from "lucide-react";
import {
  QuestionSection,
  DataTable,
  CompanyLink,
  Currency,
  DateDisplay,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import type { CompanyListRow, CompanyListResult } from "@/lib/queries/sp13/empresas";
import {
  EmpresasFilterBar,
  type EmpresasFilterBarParams,
} from "./EmpresasFilterBar";

interface Props {
  result: CompanyListResult;
  params: EmpresasFilterBarParams;
  buildPageHref: (page: number) => string;
}

const tierVariant: Record<string, "success" | "warning" | "secondary"> = {
  A: "success",
  B: "warning",
  C: "secondary",
};

function typeLabel(r: CompanyListRow): {
  text: string;
  variant: "default" | "secondary" | "info";
} {
  if (r.is_customer && r.is_supplier) return { text: "Ambos", variant: "info" };
  if (r.is_customer) return { text: "Cliente", variant: "default" };
  if (r.is_supplier) return { text: "Proveedor", variant: "secondary" };
  return { text: "—", variant: "secondary" };
}

const columns: DataTableColumn<CompanyListRow>[] = [
  {
    key: "company",
    header: "Empresa",
    alwaysVisible: true,
    cell: (r) => (
      <div className="flex items-center gap-2 min-w-0">
        <CompanyLink
          companyId={r.canonical_company_id}
          name={r.display_name}
          truncate
        />
        {r.has_shadow_flag && (
          <Badge variant="outline" className="h-4 text-[9px]">
            Shadow
          </Badge>
        )}
        {r.blacklist_level && r.blacklist_level !== "none" && (
          <Badge variant="danger" className="h-4 text-[9px]">
            69B
          </Badge>
        )}
      </div>
    ),
  },
  {
    key: "type",
    header: "Tipo",
    cell: (r) => {
      const t = typeLabel(r);
      return (
        <Badge variant={t.variant} className="h-5 text-[10px]">
          {t.text}
        </Badge>
      );
    },
    hideOnMobile: true,
  },
  {
    key: "revenue_ltm",
    header: "Revenue LTM",
    align: "right",
    cell: (r) => <Currency amount={r.revenue_ltm_mxn} compact />,
    hideOnMobile: true,
  },
  {
    key: "overdue",
    header: "AR abierto",
    align: "right",
    cell: (r) => (
      <span
        className={
          r.overdue_amount_mxn > 0
            ? "font-semibold text-danger tabular-nums"
            : "text-muted-foreground tabular-nums"
        }
      >
        <Currency amount={r.overdue_amount_mxn} compact />
      </span>
    ),
  },
  {
    key: "last_invoice",
    header: "Último movimiento",
    align: "right",
    cell: (r) =>
      r.last_invoice_date ? (
        <DateDisplay date={r.last_invoice_date} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    hideOnMobile: true,
  },
  {
    key: "tier",
    header: "Tier",
    align: "center",
    cell: (r) =>
      r.tier ? (
        <Badge variant={tierVariant[r.tier] ?? "secondary"} className="h-5">
          {r.tier}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

/**
 * SP13 E5 — Lista completa de empresas con filtros + paginacion server-side.
 */
export function CompaniesListSection({ result, params, buildPageHref }: Props) {
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
  const startIdx = (result.page - 1) * result.limit + 1;
  const endIdx = Math.min(result.page * result.limit, result.total);

  return (
    <QuestionSection
      id="todas"
      question="Todas las empresas"
      subtext={`${result.total.toLocaleString("es-MX")} empresas · página ${result.page} de ${totalPages}`}
    >
      <EmpresasFilterBar params={params} />
      <DataTable
        data={result.rows}
        columns={columns}
        rowKey={(r) => r.canonical_company_id}
        rowHref={(r) => `/empresas/${r.canonical_company_id}`}
        emptyState={{
          icon: Building2,
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
