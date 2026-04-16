import type { HandlerCtx, SyntageEvent, SyntageInvoicePayload } from "@/lib/syntage/types";

/**
 * Handles invoice.created, invoice.updated, invoice.deleted events.
 * Upserts to syntage_invoices with denormalized columns + raw_payload.
 */
export async function handleInvoiceEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as SyntageInvoicePayload;

  const isCancellation = event.type === "invoice.deleted";

  const row: Record<string, unknown> = {
    syntage_id:                obj["@id"],
    uuid:                      obj.uuid,
    taxpayer_rfc:              ctx.taxpayerRfc,
    odoo_company_id:           ctx.odooCompanyId,
    direction:                 obj.direction,
    tipo_comprobante:          obj.tipoComprobante ?? null,
    serie:                     obj.serie ?? null,
    folio:                     obj.folio ?? null,
    fecha_emision:             obj.fechaEmision ?? null,
    fecha_timbrado:            obj.fechaTimbrado ?? null,
    emisor_rfc:                obj.issuer?.rfc ?? null,
    emisor_nombre:             obj.issuer?.name ?? null,
    receptor_rfc:              obj.receiver?.rfc ?? null,
    receptor_nombre:           obj.receiver?.name ?? null,
    subtotal:                  obj.subtotal ?? null,
    descuento:                 obj.descuento ?? null,
    total:                     obj.total ?? null,
    moneda:                    obj.moneda ?? "MXN",
    tipo_cambio:               obj.tipoCambio ?? 1,
    impuestos_trasladados:     obj.impuestosTrasladados ?? null,
    impuestos_retenidos:       obj.impuestosRetenidos ?? null,
    metodo_pago:               obj.metodoPago ?? null,
    forma_pago:                obj.formaPago ?? null,
    uso_cfdi:                  obj.usoCfdi ?? null,
    estado_sat:                isCancellation ? "cancelado" : (obj.estadoSat ?? "vigente"),
    fecha_cancelacion:         isCancellation
                                 ? (obj.fechaCancelacion ?? new Date().toISOString())
                                 : (obj.fechaCancelacion ?? null),
    emisor_blacklist_status:   obj.issuer?.blacklistStatus ?? null,
    receptor_blacklist_status: obj.receiver?.blacklistStatus ?? null,
    raw_payload:               obj,
    synced_at:                 new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_invoices")
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
