/**
 * Pure row mappers for Syntage resources.
 *
 * Each map* function takes a raw Syntage object + minimal context and
 * returns the Supabase row (no DB calls). Used by the pull-sync batch
 * upsert path. Webhooks still use the one-row-at-a-time handlers in
 * src/lib/syntage/handlers/*.ts (they share the same transformations).
 */

export interface MapperCtx {
  taxpayerRfc: string;
  odooCompanyId: number;
}

type Row = Record<string, unknown>;

// ───────────────────────── helpers ─────────────────────────

function normalizeInvoiceStatus(status: unknown, canceledAt: unknown): "vigente" | "cancelado" | "cancelacion_pendiente" {
  if (canceledAt) return "cancelado";
  const s = String(status ?? "").toLowerCase();
  if (s === "cancelado" || s === "canceled") return "cancelado";
  if (s.includes("pendiente")) return "cancelacion_pendiente";
  return "vigente";
}

function invoiceDirection(obj: Row): "issued" | "received" {
  if (obj.isIssuer === true) return "issued";
  if (obj.isReceiver === true) return "received";
  return "received";
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ───────────────────────── Invoice ─────────────────────────

export function mapInvoice(obj: Row, ctx: MapperCtx): Row {
  const issuer = obj.issuer as { rfc?: string; name?: string; blacklistStatus?: string } | undefined;
  const receiver = obj.receiver as { rfc?: string; name?: string; blacklistStatus?: string } | undefined;
  const transferred = obj.transferredTaxes as { total?: number } | undefined;
  const retained = obj.retainedTaxes as { total?: number } | undefined;

  const syntageId = (obj.id as string | undefined) ?? (obj["@id"] as string | undefined);
  if (!syntageId) throw new Error("invoice: missing id");
  if (!obj.uuid) throw new Error(`invoice ${syntageId}: missing uuid`);

  return {
    syntage_id:                syntageId,
    uuid:                      obj.uuid,
    taxpayer_rfc:              ctx.taxpayerRfc,
    odoo_company_id:           ctx.odooCompanyId,
    direction:                 invoiceDirection(obj),
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
    estado_sat:                normalizeInvoiceStatus(obj.status, obj.canceledAt),
    fecha_cancelacion:         (obj.canceledAt as string | null) ?? null,
    emisor_blacklist_status:   issuer?.blacklistStatus ?? null,
    receptor_blacklist_status: receiver?.blacklistStatus ?? null,
    raw_payload:               obj,
    synced_at:                 new Date().toISOString(),
  };
}

// ───────────────────────── InvoiceLineItem ─────────────────────────

export function mapInvoiceLineItem(obj: Row, ctx: MapperCtx): Row {
  const syntageId = (obj.id as string | undefined) ?? (obj["@id"] as string | undefined);
  if (!syntageId) throw new Error("line_item: missing id");
  const invoice = obj.invoice as { uuid?: string } | undefined;

  return {
    syntage_id:       syntageId,
    invoice_uuid:     invoice?.uuid ?? null,
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    line_number:      null,
    clave_prod_serv:  obj.productIdentification ?? null,
    descripcion:      obj.description ?? null,
    cantidad:         obj.quantity ?? null,
    clave_unidad:     obj.unitCode ?? null,
    unidad:           obj.unitCode ?? null,
    valor_unitario:   obj.unitAmount ?? null,
    importe:          obj.totalAmount ?? null,
    descuento:        obj.discountAmount ?? null,
    raw_payload:      obj,
    synced_at:        new Date().toISOString(),
  };
}

// ───────────────────────── InvoicePayment ─────────────────────────

export function mapInvoicePayment(obj: Row, ctx: MapperCtx): Row {
  const syntageId = (obj.id as string | undefined) ?? (obj["@id"] as string | undefined);
  if (!syntageId) throw new Error("invoice_payment: missing id");

  const amount = typeof obj.amount === "number" ? obj.amount : null;
  const direction: "issued" | "received" = amount !== null && amount < 0 ? "issued" : "received";
  const isCancellation = obj.canceledAt != null;

  return {
    syntage_id:            syntageId,
    uuid_complemento:      syntageId,
    taxpayer_rfc:          ctx.taxpayerRfc,
    odoo_company_id:       ctx.odooCompanyId,
    direction,
    fecha_pago:            null,
    forma_pago_p:          null,
    moneda_p:              obj.currency ?? "MXN",
    tipo_cambio_p:         (obj.exchangeRate as number | null) ?? 1,
    monto:                 amount !== null ? Math.abs(amount) : null,
    num_operacion:         null,
    rfc_emisor_cta_ord:    null,
    rfc_emisor_cta_ben:    null,
    doctos_relacionados:   [
      {
        uuid_docto:         obj.invoiceUuid ?? null,
        parcialidad:        obj.installment ?? null,
        imp_saldo_ant:      obj.previousBalance ?? null,
        imp_pagado:         amount !== null ? Math.abs(amount) : null,
        imp_saldo_insoluto: obj.outstandingBalance ?? null,
      },
    ],
    estado_sat:            isCancellation ? "cancelado" : "vigente",
    raw_payload:           obj,
    synced_at:             new Date().toISOString(),
  };
}

// ───────────────────────── TaxRetention ─────────────────────────

export function mapTaxRetention(obj: Row, ctx: MapperCtx): Row {
  const syntageId = (obj.id as string | undefined) ?? (obj["@id"] as string | undefined);
  if (!syntageId) throw new Error("tax_retention: missing id");
  if (!obj.uuid) throw new Error(`tax_retention ${syntageId}: missing uuid`);

  const issuer = obj.issuer as { rfc?: string; name?: string } | undefined;
  const receiver = obj.receiver as { rfc?: string; name?: string } | undefined;
  const direction: "issued" | "received" =
    issuer?.rfc?.toUpperCase() === ctx.taxpayerRfc.toUpperCase() ? "issued" : "received";

  return {
    syntage_id:              syntageId,
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
    estado_sat:              obj.canceledAt ? "cancelado" : "vigente",
    raw_payload:             obj,
    synced_at:               new Date().toISOString(),
  };
}

// ───────────────────────── TaxReturn ─────────────────────────

export function mapTaxReturn(obj: Row, ctx: MapperCtx): Row {
  const syntageId = (obj.id as string | undefined) ?? (obj["@id"] as string | undefined);
  if (!syntageId) throw new Error("tax_return: missing id");

  const returnType = (() => {
    const s = String(obj.intervalUnit ?? "").toLowerCase();
    if (s === "anual") return "annual";
    if (s === "rif") return "rif";
    return "monthly";
  })();
  const tipoDecl = String(obj.type ?? "").toLowerCase().startsWith("complementaria") ? "complementaria" : "normal";
  const payment = obj.payment as { paidAmount?: number } | undefined;
  const ejercicio = toIntOrNull(obj.fiscalYear);
  if (!ejercicio) throw new Error(`tax_return ${syntageId}: missing fiscalYear`);

  return {
    syntage_id:          syntageId,
    taxpayer_rfc:        ctx.taxpayerRfc,
    odoo_company_id:     ctx.odooCompanyId,
    return_type:         returnType,
    ejercicio,
    periodo:             obj.period ?? null,
    impuesto:            null,
    fecha_presentacion:  obj.presentedAt ?? null,
    monto_pagado:        payment?.paidAmount ?? null,
    tipo_declaracion:    tipoDecl,
    numero_operacion:    obj.operationNumber != null ? String(obj.operationNumber) : null,
    raw_payload:         obj,
    synced_at:           new Date().toISOString(),
  };
}
