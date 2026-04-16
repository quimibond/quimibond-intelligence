// src/lib/syntage/handlers/tax-return.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

export async function handleTaxReturnEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:          obj["@id"],
    taxpayer_rfc:        ctx.taxpayerRfc,
    odoo_company_id:     ctx.odooCompanyId,
    return_type:         obj.returnType ?? "monthly",
    ejercicio:           obj.ejercicio ?? null,
    periodo:             obj.periodo ?? null,
    impuesto:            obj.impuesto ?? null,
    fecha_presentacion:  obj.fechaPresentacion ?? null,
    monto_pagado:        obj.montoPagado ?? null,
    tipo_declaracion:    obj.tipoDeclaracion ?? "normal",
    numero_operacion:    obj.numeroOperacion ?? null,
    raw_payload:         obj,
    synced_at:           new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_tax_returns")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
