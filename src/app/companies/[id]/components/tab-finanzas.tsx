"use client";

import { CreditCard } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CompanyFinancials } from "@/lib/types";
import type { RevenueRow } from "./types";
import { AgingChart } from "@/components/shared/aging-chart";
import { InvoiceTable } from "@/components/shared/invoice-table";
import { RevenueChart } from "@/components/shared/revenue-chart";
import { ScoreGauge } from "@/components/shared/score-gauge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabFinanzasProps {
  financials: CompanyFinancials | null;
  revenueRows: RevenueRow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  odooSnapshots: any[];
}

export function TabFinanzas({ financials, revenueRows, odooSnapshots }: TabFinanzasProps) {
  const revenueChartData = [...revenueRows]
    .sort(
      (a, b) =>
        new Date(a.period_start).getTime() -
        new Date(b.period_start).getTime()
    )
    .map((r) => {
      const invoiced = Number(r.total_invoiced ?? 0);
      const pending = Number(r.pending_amount ?? 0);
      const overdue = Number(r.overdue_amount ?? 0);
      return {
        period: r.period_start,
        invoiced,
        paid: Math.max(0, invoiced - pending - overdue),
        overdue,
      };
    });

  const totalInvoiced = revenueRows.reduce(
    (s, r) => s + Number(r.total_invoiced ?? 0),
    0
  );
  const totalCollected = revenueRows.reduce(
    (s, r) => s + Math.max(0, Number(r.total_invoiced ?? 0) - Number(r.pending_amount ?? 0) - Number(r.overdue_amount ?? 0)),
    0
  );

  return (
    <div className="space-y-6">
      {/* Aging Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Antiguedad de Saldos (Aging)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AgingChart data={financials?.aging ?? null} />
        </CardContent>
      </Card>

      {/* Payment Compliance + Revenue summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 flex flex-col items-center">
            <ScoreGauge
              value={financials?.payment_behavior?.compliance_score ?? null}
              label="Compliance de Pago"
              size="md"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Facturado</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
              {formatCurrency(totalInvoiced)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Cobrado</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(totalCollected)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Dias Prom. de Pago</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {financials?.payment_behavior?.avg_days_to_pay != null
                ? `${financials.payment_behavior.avg_days_to_pay}d`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pending invoices table */}
      {financials?.recent_invoices && financials.recent_invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Facturas Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceTable invoices={financials.recent_invoices} />
          </CardContent>
        </Card>
      )}

      {/* Revenue chart */}
      {revenueChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Revenue Mensual</CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueChart data={revenueChartData} />
          </CardContent>
        </Card>
      )}

      {/* Recent payments */}
      {financials?.recent_payments && financials.recent_payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pagos Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {financials.recent_payments.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{p.name}</TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">{p.payment_date}</TableCell>
                      <TableCell>
                        <Badge variant={p.payment_type === "inbound" ? "success" : "warning"}>
                          {p.payment_type === "inbound" ? "Cobro" : "Pago"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium">
                        {formatCurrency(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Credit notes */}
      {financials?.credit_notes && financials.credit_notes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Notas de Credito</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceTable invoices={financials.credit_notes} title="" />
          </CardContent>
        </Card>
      )}

      {/* Odoo Snapshots */}
      {odooSnapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Metricas Odoo (Snapshots)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Facturado</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead className="text-right">Vencido</TableHead>
                    <TableHead className="text-right">Ordenes</TableHead>
                    <TableHead className="text-right">Pipeline CRM</TableHead>
                    <TableHead className="text-right">Manufactura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {odooSnapshots.slice(0, 6).map((s: Record<string, unknown>) => (
                    <TableRow key={s.id as number}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {s.snapshot_date as string}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(Number(s.total_invoiced ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(Number(s.pending_amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                        {formatCurrency(Number(s.overdue_amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(s.open_orders_count as number) ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(Number(s.crm_pipeline_value ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(s.manufacturing_count as number) ?? 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
