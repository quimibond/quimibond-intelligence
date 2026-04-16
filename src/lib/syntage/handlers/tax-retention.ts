// src/lib/syntage/handlers/tax-retention.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

export async function handleTaxRetentionEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;
  const isCancellation = event.type === "tax_retention.deleted";

  const row: Record<string, unknown> = {
    syntage_id:              obj.id ?? obj["@id"],
    uuid:                    obj.uuid,
    taxpayer_rfc:            ctx.taxpayerRfc,
    odoo_company_id:         ctx.odooCompanyId,
    direction:               obj.direction,
    fecha_emision:           obj.fechaEmision ?? null,
    emisor_rfc:              (obj.issuer as { rfc?: string } | undefined)?.rfc ?? obj.emisorRfc ?? null,
    emisor_nombre:           (obj.issuer as { name?: string } | undefined)?.name ?? obj.emisorNombre ?? null,
    receptor_rfc:            (obj.receiver as { rfc?: string } | undefined)?.rfc ?? obj.receptorRfc ?? null,
    receptor_nombre:         (obj.receiver as { name?: string } | undefined)?.name ?? obj.receptorNombre ?? null,
    tipo_retencion:          obj.tipoRetencion ?? null,
    monto_total_operacion:   obj.montoTotalOperacion ?? null,
    monto_total_gravado:     obj.montoTotalGravado ?? null,
    monto_total_retenido:    obj.montoTotalRetenido ?? null,
    impuestos_retenidos:     obj.impuestosRetenidos ?? [],
    estado_sat:              isCancellation ? "cancelado" : (obj.estadoSat ?? "vigente"),
    raw_payload:             obj,
    synced_at:               new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_tax_retentions")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
