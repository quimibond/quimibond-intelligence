import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handles electronic_accounting_record.* events.
 *
 * Syntage's real ElectronicAccountingRecord schema per OpenAPI:
 *   { id, year (int), month (int 1-12), type, reason, fileType, filename,
 *     code, receivedAt, status, files[File] }
 *
 * Our `record_type` column maps from Syntage's `type` (uppercase enum, e.g.
 * "BALANZA" | "CATALOGO_CUENTAS" | "POLIZAS"). We normalize to lowercase to
 * match our CHECK constraint.
 */
export async function handleElectronicAccountingEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const recordType = normalizeRecordType(obj.type);

  const row: Record<string, unknown> = {
    syntage_id:       obj.id ?? obj["@id"],
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    record_type:      recordType,
    ejercicio:        toIntOrNull(obj.year),
    periodo:          obj.month != null ? String(obj.month).padStart(2, "0") : null,
    tipo_envio:       obj.reason ?? "normal",
    hash:             obj.code ?? null,
    raw_payload:      obj,
    synced_at:        new Date().toISOString(),
  };

  if (!row.syntage_id || !row.record_type || !row.ejercicio || !row.periodo) {
    throw new Error(
      `electronic_accounting event missing required fields (id=${String(row.syntage_id)}, type=${String(obj.type)}, year=${String(obj.year)}, month=${String(obj.month)})`,
    );
  }

  const { error } = await ctx.supabase
    .from("syntage_electronic_accounting")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}

function normalizeRecordType(v: unknown): "balanza" | "catalogo_cuentas" | "polizas" | null {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("balanza")) return "balanza";
  if (s.includes("catalogo")) return "catalogo_cuentas";
  if (s.includes("poliza")) return "polizas";
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
