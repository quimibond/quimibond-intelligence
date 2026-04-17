import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handles electronic_accounting_record.* events.
 *
 * Syntage's real ElectronicAccountingRecord payload (observed in production):
 *   { id, code (SAT folio), type (unused — often null), year (int),
 *     month (int 1-12), reason (e.g. "EM"), status ("accepted"|...),
 *     fileType (CT|BN|BC|BD|PL), filename (e.g. "RFC202110CT.zip"),
 *     files[], receivedAt, createdAt, updatedAt }
 *
 * The SAT's contabilidad-electrónica file type code is encoded in `fileType`
 * (not in the top-level `type`, which Syntage uses for something else):
 *   - CT        → catalogo_cuentas
 *   - BN, BC, BD, B* → balanza  (Normal / Complementaria / Dictaminada)
 *   - PL        → polizas (requested only on audit)
 *
 * `reason` carries the SAT submission reason (EM = envío mensual, etc.) and
 * we store it in `tipo_envio`. `code` is the SAT folio/acuse (stored in `hash`
 * for lack of a dedicated column).
 */
export async function handleElectronicAccountingEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const recordType = normalizeRecordType(obj.fileType, obj.filename);

  const row: Record<string, unknown> = {
    syntage_id:       obj.id ?? obj["@id"],
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    record_type:      recordType,
    ejercicio:        toIntOrNull(obj.year),
    periodo:          obj.month != null ? String(obj.month).padStart(2, "0") : null,
    tipo_envio:       obj.reason ?? obj.type ?? "normal",
    hash:             obj.code ?? null,
    raw_payload:      obj,
    synced_at:        new Date().toISOString(),
  };

  if (!row.syntage_id || !row.record_type || !row.ejercicio || !row.periodo) {
    throw new Error(
      `electronic_accounting event missing required fields (id=${String(row.syntage_id)}, fileType=${String(obj.fileType)}, year=${String(obj.year)}, month=${String(obj.month)})`,
    );
  }

  const { error } = await ctx.supabase
    .from("syntage_electronic_accounting")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}

function normalizeRecordType(
  fileType: unknown,
  filename: unknown,
): "balanza" | "catalogo_cuentas" | "polizas" | null {
  const ft = String(fileType ?? "").toUpperCase();
  const fn = String(filename ?? "").toUpperCase();

  // Primary: fileType abbreviation (most reliable when present).
  if (ft === "CT") return "catalogo_cuentas";
  if (ft.startsWith("B")) return "balanza"; // BN / BC / BD
  if (ft === "PL") return "polizas";

  // Fallback: filename suffix (e.g. PNT920218IW5202110CT.zip).
  if (fn.endsWith("CT.ZIP") || fn.endsWith("CT")) return "catalogo_cuentas";
  if (/B[NDC]?\.ZIP$/.test(fn) || /B[NDC]?$/.test(fn)) return "balanza";
  if (fn.endsWith("PL.ZIP") || fn.endsWith("PL")) return "polizas";

  return null;
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
