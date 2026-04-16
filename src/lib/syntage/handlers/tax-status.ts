// src/lib/syntage/handlers/tax-status.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

export async function handleTaxStatusEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:               obj.id ?? obj["@id"],
    taxpayer_rfc:             ctx.taxpayerRfc,
    odoo_company_id:          ctx.odooCompanyId,
    target_rfc:               obj.targetRfc ?? ctx.taxpayerRfc,
    fecha_consulta:           obj.fechaConsulta ?? new Date().toISOString(),
    opinion_cumplimiento:     obj.opinionCumplimiento ?? null,
    regimen_fiscal:           obj.regimenFiscal ?? null,
    domicilio_fiscal:         obj.domicilioFiscal ?? null,
    actividades_economicas:   obj.actividadesEconomicas ?? null,
    raw_payload:              obj,
    synced_at:                new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_tax_status")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
