"use client";

import { Package } from "lucide-react";
import { formatCurrency, productDisplay } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabProductosProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companyProducts: any[];
}

export function TabProductos({ companyProducts }: TabProductosProps) {
  if (companyProducts.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Sin productos"
        description="No se encontraron productos asociados a esta empresa."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">Ordenes</TableHead>
            <TableHead className="text-right">Qty Total</TableHead>
            <TableHead className="text-right">Revenue Total</TableHead>
            <TableHead className="text-right">Precio Prom.</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="text-right">Disponible</TableHead>
            <TableHead>Tendencia Vol.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companyProducts.map((p: Record<string, unknown>, i: number) => {
            const qty6m = Number(p.qty_6m ?? 0);
            const qtyPrev6m = Number(p.qty_prev_6m ?? 0);
            const trendPct = qtyPrev6m > 0
              ? ((qty6m - qtyPrev6m) / qtyPrev6m) * 100
              : qty6m > 0 ? 100 : 0;
            return (
              <TableRow key={i}>
                <TableCell className="font-medium text-sm">
                  {productDisplay(p)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {String(p.order_count ?? p.orders ?? "—")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(p.total_qty ?? 0).toLocaleString("es-MX")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(Number(p.total_revenue ?? 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(Number(p.avg_price ?? 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.stock_qty != null ? Number(p.stock_qty).toLocaleString("es-MX") : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.available_qty != null ? Number(p.available_qty).toLocaleString("es-MX") : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={trendPct > 10 ? "success" : trendPct < -20 ? "critical" : trendPct < 0 ? "warning" : "secondary"}>
                    {trendPct > 0 ? "+" : ""}{trendPct.toFixed(0)}%
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
