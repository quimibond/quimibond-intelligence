// src/lib/syntage/handlers/invoice-line-item.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

interface LineItemPayload {
  "@id": string;
  invoice: { uuid: string };
  lineNumber?: number;
  claveProdServ?: string;
  descripcion?: string;
  cantidad?: number;
  claveUnidad?: string;
  unidad?: string;
  valorUnitario?: number;
  importe?: number;
  descuento?: number;
}

export async function handleInvoiceLineItemEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as unknown as LineItemPayload;

  const row: Record<string, unknown> = {
    syntage_id:       obj["@id"],
    invoice_uuid:     obj.invoice?.uuid,
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    line_number:      obj.lineNumber ?? null,
    clave_prod_serv:  obj.claveProdServ ?? null,
    descripcion:      obj.descripcion ?? null,
    cantidad:         obj.cantidad ?? null,
    clave_unidad:     obj.claveUnidad ?? null,
    unidad:           obj.unidad ?? null,
    valor_unitario:   obj.valorUnitario ?? null,
    importe:          obj.importe ?? null,
    descuento:        obj.descuento ?? null,
    raw_payload:      obj,
    synced_at:        new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_invoice_line_items")
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
