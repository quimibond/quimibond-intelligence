import { ShieldAlert } from "lucide-react";
import {
  QuestionSection,
  DataTable,
  CompanyLink,
  Currency,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import type { SingleSourceCriticalRow } from "@/lib/queries/sp13/compras";

interface Props {
  rows: SingleSourceCriticalRow[];
}

const levelVariant: Record<string, "danger" | "warning" | "secondary"> = {
  single_source: "danger",
  very_high: "danger",
  high: "warning",
};

const levelLabel: Record<string, string> = {
  single_source: "Único proveedor",
  very_high: "Muy alta",
  high: "Alta",
};

const columns: DataTableColumn<SingleSourceCriticalRow>[] = [
  {
    key: "product",
    header: "Producto",
    alwaysVisible: true,
    cell: (r) => (
      <span className="font-mono text-xs">
        {r.product_display ?? `#${r.odoo_product_id}`}
      </span>
    ),
  },
  {
    key: "supplier",
    header: "Proveedor dominante",
    cell: (r) =>
      r.top_supplier_company_id != null && r.top_supplier_display ? (
        <CompanyLink
          companyId={r.top_supplier_company_id}
          name={r.top_supplier_display}
          truncate
        />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "share",
    header: "Concentración",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums">
        {r.top_supplier_share_pct.toFixed(0)}%
      </span>
    ),
  },
  {
    key: "level",
    header: "Nivel",
    align: "center",
    hideOnMobile: true,
    cell: (r) => (
      <Badge
        variant={levelVariant[r.concentration_level] ?? "secondary"}
        className="h-5 text-[10px]"
      >
        {levelLabel[r.concentration_level] ?? r.concentration_level}
      </Badge>
    ),
  },
  {
    key: "spent",
    header: "Gasto 12m",
    align: "right",
    hideOnMobile: true,
    cell: (r) => <Currency amount={r.total_spent_12m} compact />,
  },
];

export function SingleSourceSection({ rows }: Props) {
  return (
    <QuestionSection
      id="single-source"
      question="¿Tengo dependencia de un solo proveedor?"
      subtext="Top 5 SKUs con concentración crítica de un proveedor, por gasto 12m."
    >
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.odoo_product_id}
        density="compact"
        emptyState={{
          icon: ShieldAlert,
          title: "Sin dependencias críticas",
          description: "Buen mix de proveedores en el portafolio.",
        }}
      />
    </QuestionSection>
  );
}
