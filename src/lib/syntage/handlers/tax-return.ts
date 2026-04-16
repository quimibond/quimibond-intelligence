import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handles tax_return.* events.
 *
 * Syntage's real TaxReturn schema per OpenAPI:
 *   { id, taxpayer, operationNumber (number!),
 *     intervalUnit (Anual|Mensual|RIF), period (text, e.g. "Diciembre"),
 *     fiscalYear (string), type (Normal|Complementaria|...),
 *     complementary, presentedAt, captureLine, files[File],
 *     payment:{dueAmount,dueDate,code,bank,paidAmount,date,operationNumber} }
 *
 * We normalize `intervalUnit` (PascalCase Spanish) → `return_type` (snake_case
 * English lowercase) to match our CHECK constraint. Likewise for `type` →
 * `tipo_declaracion`.
 */
export async function handleTaxReturnEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;
  const payment = obj.payment as { paidAmount?: number } | undefined;

  const returnType = mapIntervalUnit(obj.intervalUnit);
  const tipoDeclaracion = mapTaxReturnType(obj.type);

  const row: Record<string, unknown> = {
    syntage_id:          obj.id ?? obj["@id"],
    taxpayer_rfc:        ctx.taxpayerRfc,
    odoo_company_id:     ctx.odooCompanyId,
    return_type:         returnType,
    ejercicio:           parseIntOrNull(obj.fiscalYear),
    periodo:             obj.period ?? null,
    impuesto:            null, // Syntage doesn't emit impuesto at this level
    fecha_presentacion:  obj.presentedAt ?? null,
    monto_pagado:        payment?.paidAmount ?? null,
    tipo_declaracion:    tipoDeclaracion,
    numero_operacion:    obj.operationNumber != null ? String(obj.operationNumber) : null,
    raw_payload:         obj,
    synced_at:           new Date().toISOString(),
  };

  if (!row.syntage_id || !row.ejercicio) {
    throw new Error(
      `tax_return event missing id/fiscalYear (id=${String(row.syntage_id)}, fiscalYear=${String(obj.fiscalYear)})`,
    );
  }

  const { error } = await ctx.supabase
    .from("syntage_tax_returns")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}

function mapIntervalUnit(v: unknown): "monthly" | "annual" | "rif" {
  const s = String(v ?? "").toLowerCase();
  if (s === "anual") return "annual";
  if (s === "rif") return "rif";
  return "monthly";
}

function mapTaxReturnType(v: unknown): "normal" | "complementaria" {
  const s = String(v ?? "").toLowerCase();
  return s.startsWith("complementaria") ? "complementaria" : "normal";
}

function parseIntOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
