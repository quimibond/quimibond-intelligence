// src/lib/syntage/handlers/invoice-payment.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

interface SyntageInvoicePaymentPayload {
  "@id": string;
  uuid: string;
  direction: "issued" | "received";
  fechaPago?: string;
  formaPagoP?: string;
  monedaP?: string;
  tipoCambioP?: number;
  monto?: number;
  numOperacion?: string;
  rfcEmisorCtaOrd?: string;
  rfcEmisorCtaBen?: string;
  doctosRelacionados?: Array<Record<string, unknown>>;
  estadoSat?: "vigente" | "cancelado" | "cancelacion_pendiente";
}

export async function handleInvoicePaymentEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as SyntageInvoicePaymentPayload;
  const isCancellation = event.type === "invoice_payment.deleted";

  const row: Record<string, unknown> = {
    syntage_id:            obj["@id"],
    uuid_complemento:      obj.uuid,
    taxpayer_rfc:          ctx.taxpayerRfc,
    odoo_company_id:       ctx.odooCompanyId,
    direction:             obj.direction,
    fecha_pago:            obj.fechaPago ?? null,
    forma_pago_p:          obj.formaPagoP ?? null,
    moneda_p:              obj.monedaP ?? "MXN",
    tipo_cambio_p:         obj.tipoCambioP ?? 1,
    monto:                 obj.monto ?? null,
    num_operacion:         obj.numOperacion ?? null,
    rfc_emisor_cta_ord:    obj.rfcEmisorCtaOrd ?? null,
    rfc_emisor_cta_ben:    obj.rfcEmisorCtaBen ?? null,
    doctos_relacionados:   obj.doctosRelacionados ?? [],
    estado_sat:            isCancellation ? "cancelado" : (obj.estadoSat ?? "vigente"),
    raw_payload:           obj,
    synced_at:             new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_invoice_payments")
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
