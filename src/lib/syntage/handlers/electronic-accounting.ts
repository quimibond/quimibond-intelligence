// src/lib/syntage/handlers/electronic-accounting.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

export async function handleElectronicAccountingEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:       obj.id ?? obj["@id"],
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    record_type:      obj.recordType,
    ejercicio:        obj.ejercicio,
    periodo:          obj.periodo,
    tipo_envio:       obj.tipoEnvio ?? "normal",
    hash:             obj.hash ?? null,
    raw_payload:      obj,
    synced_at:        new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_electronic_accounting")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
