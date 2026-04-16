// src/lib/syntage/handlers/admin.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handler for credential.* events — log-only no-op.
 */
export async function handleCredentialEvent(_ctx: HandlerCtx, _event: SyntageEvent): Promise<void> {
  // Intentionally empty. Log-only event.
}

/** link.created / link.updated / link.deleted — no-op for now. */
export async function handleLinkEvent(_ctx: HandlerCtx, _event: SyntageEvent): Promise<void> {
  // Intentionally empty. Log-only event.
}

/** extraction.created / extraction.updated — upsert into syntage_extractions. */
export async function handleExtractionEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:       obj["@id"],
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    extractor_type:   obj.extractor ?? "unknown",
    options:          obj.options ?? {},
    status:           obj.status ?? "pending",
    started_at:       obj.startedAt ?? null,
    finished_at:      obj.finishedAt ?? null,
    rows_produced:    obj.rowsProduced ?? 0,
    error:            obj.error ?? null,
    raw_payload:      obj,
    updated_at:       new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_extractions")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}

/** file.created — record metadata; binary download is enqueued separately (Phase future). */
export async function handleFileCreatedEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:                  obj["@id"],
    taxpayer_rfc:                ctx.taxpayerRfc,
    odoo_company_id:             ctx.odooCompanyId,
    file_type:                   obj.fileType ?? "unknown",
    filename:                    obj.filename ?? null,
    mime_type:                   obj.mimeType ?? null,
    size_bytes:                  obj.sizeBytes ?? null,
    download_url_cached_until:   obj.downloadUrlCachedUntil ?? null,
    raw_payload:                 obj,
  };

  const { error } = await ctx.supabase
    .from("syntage_files")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
