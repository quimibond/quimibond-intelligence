import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";

import { Currency } from "./currency";
import { DateDisplay } from "./date-display";
import { MetricRow } from "./metric-row";
import { StatusBadge } from "./status-badge";
import { CompanyLink } from "./company-link";
import { EmptyState } from "./empty-state";
import { Badge } from "@/components/ui/badge";

import { getInvoiceByName } from "@/lib/queries/unified/invoice-detail";
import { formatNumber } from "@/lib/formatters";

/**
 * InvoiceDetailView — server component que se carga dentro de un BottomSheet
 * cuando el CEO tapea un EvidenceChip de factura.
 */
export async function InvoiceDetailView({
  reference,
}: {
  reference: string;
}) {
  const inv = await getInvoiceByName(reference);

  if (!inv) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Factura no encontrada"
        description={`No existe factura con referencia ${reference}.`}
        compact
      />
    );
  }

  const isOverdue = (inv.days_overdue ?? 0) > 0;
  const isPaid = inv.payment_state === "paid";

  return (
    <div className="space-y-4">
      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-2">
        {isPaid ? (
          <StatusBadge status="paid" />
        ) : isOverdue ? (
          <StatusBadge status="overdue" />
        ) : (
          <StatusBadge status={(inv.payment_state ?? "pending") as "pending"} />
        )}
        {inv.currency && (
          <Badge variant="secondary" className="text-[10px]">
            {inv.currency}
          </Badge>
        )}
        {inv.cfdi_sat_state === "valid" && (
          <Badge variant="success" className="text-[10px]">
            <CheckCircle2 className="mr-1 h-2.5 w-2.5" aria-hidden />
            SAT válido
          </Badge>
        )}
      </div>

      {/* Amount hero */}
      <div className="rounded-md border border-border/60 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Monto total
        </div>
        <div className="text-2xl font-bold tabular-nums">
          <Currency amount={inv.amount_total_mxn} />
        </div>
        {!isPaid && inv.amount_residual_mxn > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            Por cobrar:{" "}
            <span className="font-semibold text-danger">
              <Currency amount={inv.amount_residual_mxn} />
            </span>
          </div>
        )}
      </div>

      {/* Meta */}
      <div>
        {inv.company_id && inv.company_name && (
          <MetricRow
            label="Cliente"
            value={
              <CompanyLink
                companyId={inv.company_id}
                name={inv.company_name}
                truncate
              />
            }
          />
        )}
        {inv.salesperson_name && (
          <MetricRow label="Vendedor" value={inv.salesperson_name} />
        )}
        <MetricRow
          label="Fecha factura"
          value={inv.invoice_date ? <DateDisplay date={inv.invoice_date} /> : "—"}
        />
        <MetricRow
          label="Vencimiento"
          value={inv.due_date ? <DateDisplay date={inv.due_date} /> : "—"}
          alert={isOverdue}
        />
        {inv.days_overdue != null && inv.days_overdue > 0 && (
          <MetricRow
            label="Días vencida"
            value={inv.days_overdue}
            format="number"
            alert
          />
        )}
        {inv.payment_date && (
          <MetricRow
            label="Fecha de pago"
            value={<DateDisplay date={inv.payment_date} />}
          />
        )}
        {inv.days_to_pay != null && inv.days_to_pay > 0 && (
          <MetricRow
            label="Días para pagar"
            value={inv.days_to_pay}
            format="days"
          />
        )}
        <MetricRow
          label="Sin IVA"
          value={inv.amount_untaxed_mxn}
          format="currency"
          compact
        />
        {inv.ref && <MetricRow label="Referencia" value={inv.ref} />}
      </div>

      {/* CFDI */}
      {inv.cfdi_uuid && (
        <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-[10px] text-muted-foreground">
          <div className="text-[9px] uppercase tracking-wide">CFDI UUID</div>
          <div className="break-all">{inv.cfdi_uuid}</div>
        </div>
      )}

      {/* Lines */}
      {inv.lines.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Conceptos ({inv.lines.length})
          </div>
          <div className="space-y-1">
            {inv.lines.map((line, i) => (
              <div
                key={i}
                className="flex items-start justify-between gap-2 border-b border-border/60 py-1.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <FileText className="h-2.5 w-2.5" aria-hidden />
                    {line.product_ref && (
                      <span className="font-mono">{line.product_ref}</span>
                    )}
                  </div>
                  <div className="truncate text-xs">
                    {line.product_name ?? "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatNumber(line.quantity)} × {" "}
                    <Currency amount={line.price_unit} compact />
                    {line.discount > 0 && ` (-${line.discount.toFixed(0)}%)`}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <Currency amount={line.price_subtotal_mxn} compact />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
