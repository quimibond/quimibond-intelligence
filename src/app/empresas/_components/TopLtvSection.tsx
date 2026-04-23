import Link from "next/link";
import { Building2 } from "lucide-react";
import {
  QuestionSection,
  DataTable,
  CompanyLink,
  Currency,
  SourceBadge,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import type { TopLtvCustomer } from "@/lib/queries/sp13/empresas";

interface TopLtvSectionProps {
  rows: TopLtvCustomer[];
}

const tierVariant: Record<string, "success" | "warning" | "secondary"> = {
  A: "success",
  B: "warning",
  C: "secondary",
};

const columns: DataTableColumn<TopLtvCustomer>[] = [
  {
    key: "company",
    header: "Cliente",
    alwaysVisible: true,
    cell: (r) => (
      <CompanyLink
        companyId={r.canonical_company_id}
        name={r.display_name}
        truncate
      />
    ),
  },
  {
    key: "ltv",
    header: "LTV total",
    align: "right",
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <Currency amount={r.lifetime_value_mxn} compact />
        <SourceBadge source="sat" />
      </span>
    ),
  },
  {
    key: "revenue_ytd",
    header: "Revenue YTD",
    align: "right",
    hideOnMobile: true,
    cell: (r) => <Currency amount={r.revenue_ytd_mxn} compact />,
  },
  {
    key: "tier",
    header: "Tier",
    align: "center",
    hideOnMobile: true,
    cell: (r) =>
      r.tier ? (
        <Badge variant={tierVariant[r.tier] ?? "secondary"} className="h-5">
          {r.tier}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "salesperson",
    header: "Vendedor",
    hideOnMobile: true,
    cell: (r) => (
      <span className="truncate text-xs text-muted-foreground">
        {r.salesperson ?? "—"}
      </span>
    ),
  },
];

/**
 * SP13 E2 — Top 5 LTV. "Ver todos" enlaza a E5 con filtro por LTV desc.
 */
export function TopLtvSection({ rows }: TopLtvSectionProps) {
  return (
    <QuestionSection
      id="top-ltv"
      question="¿Quiénes son los más importantes?"
      subtext="Top 5 clientes por valor de vida (LTV)."
      actions={
        <Link
          href="/empresas?sort=-ltv&type=cliente"
          className="text-xs font-medium text-primary hover:underline"
        >
          Ver todos →
        </Link>
      }
    >
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.canonical_company_id}
        rowHref={(r) => `/empresas/${r.canonical_company_id}`}
        density="compact"
        emptyState={{
          icon: Building2,
          title: "Sin clientes con LTV registrado",
          description: "Aún no hay facturación que agregue al LTV.",
        }}
      />
    </QuestionSection>
  );
}
