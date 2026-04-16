import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handles invoice_payment.* events.
 *
 * Syntage's InvoicePayment schema represents ONE installment payment for ONE
 * invoice (not a full CFDI Tipo P — that's split across rows). Real fields per
 * the OpenAPI spec:
 *   { id, invoiceUuid, currency, exchangeRate, installment, previousBalance,
 *     amount (+income / -expense), outstandingBalance, invoice (IRI),
 *     batchPayment (IRI), canceledAt, createdAt, updatedAt }
 *
 * NOTE: fechaPago, numOperacion and bank RFCs live on the BatchPayment, not
 * here — leave NULL until we enrich via GET /batch-payments/{id} in Phase 3+.
 *
 * We set `direction` from the sign of `amount`: positive → received (income),
 * negative → issued (expense). Syntage encodes direction via sign per docs.
 * uuid_complemento stores the InvoicePayment own id (UUID) because Syntage
 * doesn't expose a distinct complemento CFDI UUID at this granularity.
 */
export async function handleInvoicePaymentEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const amount = typeof obj.amount === "number" ? obj.amount : null;
  const direction: "issued" | "received" =
    amount !== null && amount < 0 ? "issued" : "received";

  const isCancellation =
    event.type === "invoice_payment.deleted" || obj.canceledAt != null;

  const row: Record<string, unknown> = {
    syntage_id:            obj.id ?? obj["@id"],
    uuid_complemento:      obj.id, // Syntage has no distinct complemento UUID here
    taxpayer_rfc:          ctx.taxpayerRfc,
    odoo_company_id:       ctx.odooCompanyId,
    direction,
    fecha_pago:            null, // lives in BatchPayment — enriched in Phase 3+
    forma_pago_p:          null,
    moneda_p:              obj.currency ?? "MXN",
    tipo_cambio_p:         (obj.exchangeRate as number | null) ?? 1,
    monto:                 amount !== null ? Math.abs(amount) : null,
    num_operacion:         null, // lives in BatchPayment
    rfc_emisor_cta_ord:    null,
    rfc_emisor_cta_ben:    null,
    doctos_relacionados:   [
      {
        uuid_docto:          obj.invoiceUuid ?? null,
        parcialidad:         obj.installment ?? null,
        imp_saldo_ant:       obj.previousBalance ?? null,
        imp_pagado:          amount !== null ? Math.abs(amount) : null,
        imp_saldo_insoluto:  obj.outstandingBalance ?? null,
      },
    ],
    estado_sat:            isCancellation ? "cancelado" : "vigente",
    raw_payload:           obj,
    synced_at:             new Date().toISOString(),
  };

  if (!row.syntage_id) {
    throw new Error("invoice_payment event missing id");
  }

  const { error } = await ctx.supabase
    .from("syntage_invoice_payments")
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
