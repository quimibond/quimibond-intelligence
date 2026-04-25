import { Flame } from "lucide-react";
import {
  QuestionSection,
  DataTable,
  Currency,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import type { StockoutRow, StockoutUrgency } from "@/lib/queries/sp13/compras";

interface Props {
  rows: StockoutRow[];
}

const urgencyVariant: Record<StockoutUrgency, "danger" | "warning" | "secondary" | "success"> = {
  STOCKOUT: "danger",
  CRITICAL: "danger",
  URGENT: "warning",
  ATTENTION: "secondary",
  OK: "success",
};

const columns: DataTableColumn<StockoutRow>[] = [
  {
    key: "product",
    header: "Producto",
    alwaysVisible: true,
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate font-mono text-xs">{r.product_ref ?? "—"}</div>
        <div className="truncate text-xs text-muted-foreground">{r.product_name ?? ""}</div>
      </div>
    ),
  },
  {
    key: "urgency",
    header: "Urgencia",
    align: "center",
    cell: (r) => (
      <Badge variant={urgencyVariant[r.urgency]} className="h-5 text-[10px]">
        {r.urgency}
      </Badge>
    ),
  },
  {
    key: "available",
    header: "Disponible",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.available_qty)}</span>
    ),
  },
  {
    key: "days",
    header: "Días stock",
    align: "right",
    hideOnMobile: true,
    cell: (r) => (
      <span className="tabular-nums">
        {r.days_of_stock != null ? Math.round(r.days_of_stock) : "—"}
      </span>
    ),
  },
  {
    key: "suggest",
    header: "Sugerido",
    align: "right",
    hideOnMobile: true,
    cell: (r) => (
      <span className="tabular-nums">{Math.round(r.suggested_order_qty)}</span>
    ),
  },
  {
    key: "supplier",
    header: "Último proveedor",
    hideOnMobile: true,
    cell: (r) => (
      <span className="truncate text-xs text-muted-foreground">
        {r.last_supplier_name ?? "—"}
      </span>
    ),
  },
  {
    key: "cost",
    header: "Costo reposición",
    align: "right",
    hideOnMobile: true,
    cell: (r) => <Currency amount={r.replenish_cost_mxn} compact />,
  },
];

export function UrgentStockoutsSection({ rows }: Props) {
  return (
    <QuestionSection
      id="urgent-stockouts"
      question="¿Qué necesito reordenar urgente?"
      subtext="Top 5 SKUs con riesgo de stockout / crítico / urgente, ordenados por priority score."
    >
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.odoo_product_id}
        density="compact"
        emptyState={{
          icon: Flame,
          title: "No hay urgencias",
          description: "Stock bajo control. Próxima ejecución del cron actualizará.",
        }}
      />
    </QuestionSection>
  );
}
