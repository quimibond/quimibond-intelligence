import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handles invoice_line_item.* events (conceptos del CFDI).
 *
 * Syntage's real InvoiceLineItem schema per OpenAPI:
 *   { id, invoice (full Invoice obj — we only need invoice.uuid),
 *     identificationNumber, productIdentification, description,
 *     unitAmount, unitCode, quantity, discountAmount, totalAmount,
 *     retainedTaxes, transferredTaxes }
 *
 * Note field name differences vs. our table columns:
 *   - `productIdentification`   → clave_prod_serv (catálogo SAT ClaveProdServ)
 *   - `description`             → descripcion
 *   - `unitCode`                → clave_unidad
 *   - `unitAmount`              → valor_unitario
 *   - `quantity`                → cantidad
 *   - `totalAmount`             → importe
 *   - `discountAmount`          → descuento
 *
 * `line_number` is not provided by Syntage; we leave it NULL. Order within an
 * invoice can be derived from `invoice.items[]` position at query time.
 */
export async function handleInvoiceLineItemEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;
  const invoice = obj.invoice as { uuid?: string; id?: string } | undefined;
  const invoiceUuid = invoice?.uuid ?? null;

  const row: Record<string, unknown> = {
    syntage_id:       obj.id ?? obj["@id"],
    invoice_uuid:     invoiceUuid,
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    line_number:      null, // not provided by Syntage
    clave_prod_serv:  obj.productIdentification ?? null,
    descripcion:      obj.description ?? null,
    cantidad:         obj.quantity ?? null,
    clave_unidad:     obj.unitCode ?? null,
    unidad:           obj.unitCode ?? null,
    valor_unitario:   obj.unitAmount ?? null,
    importe:          obj.totalAmount ?? null,
    descuento:        obj.discountAmount ?? null,
    raw_payload:      obj,
    synced_at:        new Date().toISOString(),
  };

  if (!row.syntage_id) {
    throw new Error("invoice_line_item event missing id");
  }
  if (!row.invoice_uuid) {
    // FK requires the parent invoice; if payload came before invoice event,
    // we throw → Syntage retries (backoff handles ordering).
    throw new Error(
      `invoice_line_item event missing invoice.uuid (syntage_id=${String(row.syntage_id)})`,
    );
  }

  const { error } = await ctx.supabase
    .from("syntage_invoice_line_items")
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
