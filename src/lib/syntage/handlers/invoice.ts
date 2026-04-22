import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handles invoice.created, invoice.updated, invoice.deleted events.
 * Upserts to syntage_invoices with denormalized columns + raw_payload.
 *
 * Syntage's real webhook payload is camelCase English, NOT the JSON-LD
 * Spanish-keyed shape suggested by their API reference. Sample fields:
 *   { id, uuid, type ("I"|"E"|"P"|"N"|"T"), issuedAt, certifiedAt,
 *     issuer:{rfc,name,blacklistStatus}, receiver:{rfc,name,blacklistStatus},
 *     subtotal, discount, total, currency, exchangeRate,
 *     transferredTaxes:{total,...}, retainedTaxes:{total,...},
 *     paymentType ("PUE"|"PPD"), paymentMethod ("99","03",...),
 *     usage ("G01","G03",...), status ("VIGENTE"|"CANCELADO"),
 *     canceledAt, isIssuer, isReceiver, ... }
 */
export async function handleInvoiceEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const isCancellation =
    event.type === "invoice.deleted" ||
    String(obj.status ?? "").toUpperCase() === "CANCELADO";

  const direction = resolveDirection(obj);
  const estadoSat = normalizeEstadoSat(obj.status, isCancellation);

  const issuer = obj.issuer as { rfc?: string; name?: string; blacklistStatus?: string } | undefined;
  const receiver = obj.receiver as { rfc?: string; name?: string; blacklistStatus?: string } | undefined;
  const transferred = obj.transferredTaxes as { total?: number } | undefined;
  const retained = obj.retainedTaxes as { total?: number } | undefined;

  const row: Record<string, unknown> = {
    syntage_id:                obj.id ?? obj["@id"],
    uuid:                      obj.uuid,
    taxpayer_rfc:              ctx.taxpayerRfc,
    odoo_company_id:           ctx.odooCompanyId,
    direction,
    tipo_comprobante:          obj.type ?? null,
    serie:                     obj.serie ?? null,
    folio:                     obj.folio ?? obj.internalIdentifier ?? null,
    fecha_emision:             obj.issuedAt ?? null,
    fecha_timbrado:            obj.certifiedAt ?? null,
    emisor_rfc:                issuer?.rfc ?? null,
    emisor_nombre:             issuer?.name ?? null,
    receptor_rfc:              receiver?.rfc ?? null,
    receptor_nombre:           receiver?.name ?? null,
    subtotal:                  obj.subtotal ?? null,
    descuento:                 obj.discount ?? null,
    total:                     obj.total ?? null,
    moneda:                    obj.currency ?? "MXN",
    tipo_cambio:               (obj.exchangeRate as number | null) ?? 1,
    impuestos_trasladados:     transferred?.total ?? null,
    impuestos_retenidos:       retained?.total ?? null,
    metodo_pago:               obj.paymentType ?? null,
    forma_pago:                obj.paymentMethod ?? null,
    uso_cfdi:                  obj.usage ?? null,
    estado_sat:                estadoSat,
    fecha_cancelacion:         obj.canceledAt ?? (isCancellation ? new Date().toISOString() : null),
    emisor_blacklist_status:   issuer?.blacklistStatus ?? null,
    receptor_blacklist_status: receiver?.blacklistStatus ?? null,
    raw_payload:               obj,
    synced_at:                 new Date().toISOString(),
  };

  if (!row.syntage_id || !row.uuid) {
    throw new Error(
      `invoice event missing id/uuid (got id=${String(row.syntage_id)}, uuid=${String(row.uuid)})`,
    );
  }

  const { error } = await ctx.supabase
    .from("syntage_invoices") // SP5-EXCEPTION: SAT source-layer writer — syntage_invoices is the canonical Bronze intake for SAT CFDI invoices. TODO SP6: pipe through canonical_invoices on insert.
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}

function resolveDirection(obj: Record<string, unknown>): "issued" | "received" {
  if (obj.isIssuer === true) return "issued";
  if (obj.isReceiver === true) return "received";
  // Fallback: if neither flag is present, default to 'received'.
  return "received";
}

function normalizeEstadoSat(
  status: unknown,
  isCancellation: boolean,
): "vigente" | "cancelado" | "cancelacion_pendiente" {
  if (isCancellation) return "cancelado";
  const s = String(status ?? "").toLowerCase();
  if (s === "cancelado" || s === "canceled") return "cancelado";
  if (s.includes("pendiente")) return "cancelacion_pendiente";
  return "vigente";
}
