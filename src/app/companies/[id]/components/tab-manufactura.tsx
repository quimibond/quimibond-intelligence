"use client";

import { useEffect, useState } from "react";
import { Factory } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
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

interface TabManufacturaProps {
  companyId: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManufacturingOrder = Record<string, any>;

function stateLabel(state: string | null): { label: string; variant: "success" | "warning" | "secondary" | "critical" | "info" } {
  switch (state) {
    case "done":
      return { label: "Terminada", variant: "success" };
    case "confirmed":
      return { label: "Confirmada", variant: "info" };
    case "progress":
      return { label: "En Proceso", variant: "warning" };
    case "draft":
      return { label: "Borrador", variant: "secondary" };
    case "cancel":
      return { label: "Cancelada", variant: "critical" };
    default:
      return { label: state ?? "—", variant: "secondary" };
  }
}

export function TabManufactura({ companyId }: TabManufacturaProps) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<ManufacturingOrder[]>([]);

  useEffect(() => {
    async function fetchOrders() {
      const { data } = await supabase
        .from("odoo_manufacturing")
        .select("*")
        .eq("company_id", companyId)
        .order("date_start", { ascending: false })
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
        icon={Factory}
        title="Sin ordenes de manufactura"
        description="No se encontraron ordenes de manufactura asociadas a esta empresa."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Orden</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead>Inicio</TableHead>
            <TableHead>Fin</TableHead>
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
                <TableCell className="text-sm text-muted-foreground">
                  {o.product_name ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={variant}>{label}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {o.qty != null ? Number(o.qty).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                  {formatDate(o.date_start)}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                  {formatDate(o.date_finished)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
