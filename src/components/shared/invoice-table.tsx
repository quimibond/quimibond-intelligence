"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Invoice {
  name: string;
  invoice_date: string | null;
  due_date: string | null;
  amount_total: number;
  amount_residual: number;
  payment_state: string | null;
  days_overdue: number;
  currency: string;
}

function fmt(v: number): string {
  return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function overdueColor(days: number): string {
  if (days <= 0) return "";
  if (days <= 30) return "text-amber-600 dark:text-amber-400";
  if (days <= 60) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400 font-semibold";
}

function stateBadge(state: string | null) {
  if (!state) return null;
  const map: Record<string, { label: string; variant: "success" | "warning" | "critical" | "secondary" }> = {
    paid: { label: "Pagada", variant: "success" },
    in_payment: { label: "En pago", variant: "success" },
    not_paid: { label: "Pendiente", variant: "warning" },
    partial: { label: "Parcial", variant: "warning" },
    reversed: { label: "Revertida", variant: "critical" },
  };
  const m = map[state] ?? { label: state, variant: "secondary" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function InvoiceTable({
  invoices,
  title,
}: {
  invoices: Invoice[];
  title?: string;
}) {
  if (invoices.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-6">
        Sin facturas
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {title && (
        <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Factura</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-center">Dias Venc.</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => (
              <TableRow
                key={inv.name}
                className={cn(
                  inv.days_overdue > 60 && inv.amount_residual > 0
                    ? "bg-red-500/5"
                    : inv.days_overdue > 30 && inv.amount_residual > 0
                      ? "bg-amber-500/5"
                      : ""
                )}
              >
                <TableCell className="font-medium text-sm">
                  {inv.name}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">
                  {inv.invoice_date ?? "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">
                  {inv.due_date ?? "—"}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {fmt(inv.amount_total)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums font-medium">
                  {inv.amount_residual > 0 ? fmt(inv.amount_residual) : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-center text-sm tabular-nums",
                    overdueColor(inv.days_overdue)
                  )}
                >
                  {inv.amount_residual > 0 && inv.days_overdue > 0
                    ? `${inv.days_overdue}d`
                    : "—"}
                </TableCell>
                <TableCell>{stateBadge(inv.payment_state)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
