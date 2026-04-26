import { Truck } from "lucide-react";
import {
  QuestionSection,
  DataTable,
  CompanyLink,
  Currency,
  type DataTableColumn,
} from "@/components/patterns";
import type { TopSupplierRow } from "@/lib/queries/sp13/compras";

interface Props {
  rows: TopSupplierRow[];
}

const columns: DataTableColumn<TopSupplierRow>[] = [
  {
    key: "supplier",
    header: "Proveedor",
    alwaysVisible: true,
    cell: (r) =>
      r.canonical_company_id != null ? (
        <CompanyLink
          companyId={r.canonical_company_id}
          name={r.supplier_name}
          truncate
        />
      ) : (
        <span className="truncate">{r.supplier_name}</span>
      ),
  },
  {
    key: "spent",
    header: "Gasto 12m",
    align: "right",
    cell: (r) => <Currency amount={r.total_spent} compact />,
  },
  {
    key: "products",
    header: "SKUs",
    align: "right",
    hideOnMobile: true,
    cell: (r) => (
      <span className="tabular-nums">{r.product_count.toLocaleString("es-MX")}</span>
    ),
  },
  {
    key: "orders",
    header: "OCs",
    align: "right",
    hideOnMobile: true,
    cell: (r) => (
      <span className="tabular-nums">{r.order_count.toLocaleString("es-MX")}</span>
    ),
  },
];

export function TopSuppliersSection({ rows }: Props) {
  return (
    <QuestionSection
      id="top-suppliers"
      question="¿A quién le compro más?"
      subtext="Top 5 proveedores por gasto últimos 12 meses."
    >
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.canonical_company_id ?? r.supplier_name}
        rowHref={(r) =>
          r.canonical_company_id != null ? `/empresas/${r.canonical_company_id}` : null
        }
        density="compact"
        emptyState={{
          icon: Truck,
          title: "Sin proveedores activos",
          description: "No hay líneas de compra en los últimos 12 meses.",
        }}
      />
    </QuestionSection>
  );
}
