"use client";

import { useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabVentasProps {
  companyId: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SaleOrder = Record<string, any>;

function stateLabel(state: string | null): { label: string; variant: "success" | "warning" | "secondary" | "critical" | "info" } {
  switch (state) {
    case "sale":
      return { label: "Confirmada", variant: "success" };
    case "done":
      return { label: "Bloqueada", variant: "info" };
    case "draft":
      return { label: "Borrador", variant: "secondary" };
    case "sent":
      return { label: "Enviada", variant: "warning" };
    case "cancel":
      return { label: "Cancelada", variant: "critical" };
    default:
      return { label: state ?? "—", variant: "secondary" };
  }
}

export function TabVentas({ companyId }: TabVentasProps) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<SaleOrder[]>([]);

  useEffect(() => {
    async function fetchOrders() {
      const { data } = await supabase
        .from("odoo_sale_orders")
        .select("*")
        .eq("company_id", companyId)
        .order("date_order", { ascending: false })
        .limit(100);

      setOrders(data ?? []);
      setLoading(false);
    }

    fetchOrders();
  }, [companyId]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Sin ordenes de venta"
        description="No se encontraron ordenes de venta asociadas a esta empresa."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Orden</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead className="text-right">Subtotal</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o, i) => {
            const { label, variant } = stateLabel(o.state);
            return (
              <TableRow key={o.id ?? i}>
                <TableCell className="font-medium text-sm">
                  {o.name ?? "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                  {formatDate(o.date_order)}
                </TableCell>
                <TableCell>
                  <Badge variant={variant}>{label}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {o.partner_name ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatCurrency(Number(o.amount_untaxed ?? 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm font-medium">
                  {formatCurrency(Number(o.amount_total ?? 0))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
