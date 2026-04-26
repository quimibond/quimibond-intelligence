import { TrendingUp } from "lucide-react";
import {
  QuestionSection,
  DataTable,
  Currency,
  DateDisplay,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import type { PriceAnomalyRow } from "@/lib/queries/sp13/compras";

interface Props {
  rows: PriceAnomalyRow[];
}

const flagVariant: Record<string, "danger" | "warning" | "info" | "secondary"> = {
  price_overpaid: "danger",
  price_above_avg: "warning",
  price_below_avg: "info",
};
const flagLabel: Record<string, string> = {
  price_overpaid: "Sobrecosto",
  price_above_avg: "Arriba prom.",
  price_below_avg: "Abajo prom.",
};

const columns: DataTableColumn<PriceAnomalyRow>[] = [
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
    key: "supplier",
    header: "Proveedor",
    hideOnMobile: true,
    cell: (r) => (
      <span className="truncate text-xs text-muted-foreground">
        {r.last_supplier ?? "—"}
      </span>
    ),
  },
  {
    key: "flag",
    header: "Señal",
    align: "center",
    cell: (r) => (
      <Badge variant={flagVariant[r.price_flag] ?? "secondary"} className="h-5 text-[10px]">
        {flagLabel[r.price_flag] ?? r.price_flag}
      </Badge>
    ),
  },
  {
    key: "vs_avg",
    header: "vs promedio",
    align: "right",
    cell: (r) => (
      <span
        className={
          (r.price_vs_avg_pct ?? 0) > 5
            ? "text-danger tabular-nums"
            : (r.price_vs_avg_pct ?? 0) < -5
              ? "text-success tabular-nums"
              : "tabular-nums"
        }
      >
        {r.price_vs_avg_pct != null
          ? `${r.price_vs_avg_pct > 0 ? "+" : ""}${r.price_vs_avg_pct.toFixed(1)}%`
          : "—"}
      </span>
    ),
  },
  {
    key: "spent",
    header: "Gasto",
    align: "right",
    hideOnMobile: true,
    cell: (r) => <Currency amount={r.total_spent} compact />,
  },
  {
    key: "last_date",
    header: "Última compra",
    align: "right",
    hideOnMobile: true,
    cell: (r) =>
      r.last_purchase_date ? (
        <DateDisplay date={r.last_purchase_date} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export function PriceAnomaliesSection({ rows }: Props) {
  return (
    <QuestionSection
      id="price-anomalies"
      question="¿Estoy pagando precios anormales?"
      subtext="Top 5 anomalías de precio (sobrepagos, arriba del promedio histórico) ponderadas por gasto."
    >
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => `${r.product_ref ?? "_"}-${r.last_supplier ?? "_"}`}
        density="compact"
        emptyState={{
          icon: TrendingUp,
          title: "Precios estables",
          description: "Sin anomalías significativas de precio.",
        }}
      />
    </QuestionSection>
  );
}
