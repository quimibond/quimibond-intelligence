"use client";

import { useEffect, useState } from "react";
import { Banknote } from "lucide-react";
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

interface TabPagosProps {
  companyId: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payment = Record<string, any>;

function paymentTypeLabel(type: string | null): { label: string; variant: "success" | "warning" | "secondary" | "critical" | "info" } {
  switch (type) {
    case "inbound":
      return { label: "Ingreso", variant: "success" };
    case "outbound":
      return { label: "Egreso", variant: "critical" };
    default:
      return { label: type ?? "—", variant: "secondary" };
  }
}

function stateLabel(state: string | null): { label: string; variant: "success" | "warning" | "secondary" | "critical" | "info" } {
  switch (state) {
    case "posted":
      return { label: "Publicado", variant: "success" };
    case "draft":
      return { label: "Borrador", variant: "secondary" };
    case "sent":
      return { label: "Enviado", variant: "warning" };
    case "reconciled":
      return { label: "Conciliado", variant: "info" };
    case "cancelled":
    case "cancel":
      return { label: "Cancelado", variant: "critical" };
    default:
      return { label: state ?? "—", variant: "secondary" };
  }
}

export function TabPagos({ companyId }: TabPagosProps) {
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    async function fetchPayments() {
      const { data } = await supabase
        .from("odoo_payments")
        .select("*")
        .eq("company_id", companyId)
        .order("payment_date", { ascending: false })
        .limit(100);

      setPayments(data ?? []);
      setLoading(false);
    }

    fetchPayments();
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

  if (payments.length === 0) {
    return (
      <EmptyState
        icon={Banknote}
        title="Sin pagos"
        description="No se encontraron pagos asociados a esta empresa."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead>Moneda</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p, i) => {
            const typeInfo = paymentTypeLabel(p.payment_type);
            const stateInfo = stateLabel(p.state);
            return (
              <TableRow key={p.id ?? i}>
                <TableCell className="font-medium text-sm">
                  {p.name ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={typeInfo.variant}>{typeInfo.label}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm font-medium">
                  {formatCurrency(Number(p.amount ?? 0))}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {p.currency ?? "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                  {formatDate(p.payment_date)}
                </TableCell>
                <TableCell>
                  <Badge variant={stateInfo.variant}>{stateInfo.label}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
