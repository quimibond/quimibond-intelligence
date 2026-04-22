import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";
import { mapInvoicePayment } from "@/lib/syntage/mappers";

/**
 * Handles invoice_payment.* events.
 *
 * Delegates field mapping al pure mapper compartido con pull-sync (mappers.ts).
 * El payload trae batchPayment embedded como objeto con operationNumber, date,
 * paymentMethod, payerBank[]/beneficiaryBank[] — el mapper los extrae inline.
 *
 * direction derivado del signo de `amount`: positivo → received, negativo →
 * issued. uuid_complemento usa el id del InvoicePayment (Syntage no expone
 * un UUID de complemento distinto a este granularity).
 */
export async function handleInvoicePaymentEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;
  const isCancellation =
    event.type === "invoice_payment.deleted" || obj.canceledAt != null;

  const row = mapInvoicePayment(obj, {
    taxpayerRfc: ctx.taxpayerRfc,
    odooCompanyId: ctx.odooCompanyId,
  });
  if (isCancellation) row.estado_sat = "cancelado";

  if (!row.syntage_id) {
    throw new Error("invoice_payment event missing id");
  }

  const { error } = await ctx.supabase
    .from("syntage_invoice_payments") // SP5-EXCEPTION: SAT source-layer writer — syntage_invoice_payments is the canonical Bronze intake for SAT payment complements. TODO SP6: pipe through canonical_payment_allocations.
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
