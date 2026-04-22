import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handles tax_retention.* events.
 *
 * Syntage's real TaxRetention schema per OpenAPI:
 *   { id, uuid, version, code, description,
 *     issuer:{rfc,name,curp}, receiver:{rfc,name,nationality,curp},
 *     pac, internalIdentifier, issuedAt, certifiedAt, canceledAt,
 *     items[{baseAmount,taxType,retainedAmount,paymentType}],
 *     totalOperationAmount, totalTaxableAmount, totalExemptAmount,
 *     totalRetainedAmount, periodFrom, periodTo, pdf (bool), xml (bool) }
 *
 * `direction` derives from whether Quimibond's RFC is issuer or receiver.
 * `tipo_retencion` uses Syntage's `code` (SAT catálogo de retenciones).
 */
export async function handleTaxRetentionEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;
  const isCancellation = event.type === "tax_retention.deleted" || obj.canceledAt != null;

  const issuer = obj.issuer as { rfc?: string; name?: string } | undefined;
  const receiver = obj.receiver as { rfc?: string; name?: string } | undefined;

  const direction: "issued" | "received" =
    issuer?.rfc?.toUpperCase() === ctx.taxpayerRfc.toUpperCase() ? "issued" : "received";

  const row: Record<string, unknown> = {
    syntage_id:              obj.id ?? obj["@id"],
    uuid:                    obj.uuid,
    taxpayer_rfc:            ctx.taxpayerRfc,
    odoo_company_id:         ctx.odooCompanyId,
    direction,
    fecha_emision:           obj.issuedAt ?? null,
    emisor_rfc:              issuer?.rfc ?? null,
    emisor_nombre:           issuer?.name ?? null,
    receptor_rfc:            receiver?.rfc ?? null,
    receptor_nombre:         receiver?.name ?? null,
    tipo_retencion:          obj.code ?? null,
    monto_total_operacion:   obj.totalOperationAmount ?? null,
    monto_total_gravado:     obj.totalTaxableAmount ?? null,
    monto_total_retenido:    obj.totalRetainedAmount ?? null,
    impuestos_retenidos:     obj.items ?? [],
    estado_sat:              isCancellation ? "cancelado" : "vigente",
    raw_payload:             obj,
    synced_at:               new Date().toISOString(),
  };

  if (!row.syntage_id || !row.uuid) {
    throw new Error(
      `tax_retention event missing id/uuid (id=${String(row.syntage_id)}, uuid=${String(row.uuid)})`,
    );
  }

  const { error } = await ctx.supabase
    .from("syntage_tax_retentions") // SP5-EXCEPTION: SAT source-layer writer — syntage_tax_retentions is the canonical Bronze intake for SAT retentions. TODO SP6: pipe through canonical_tax_events.
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
