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

/**
 * Handles extraction.created / extraction.updated events.
 *
 * Syntage's real Extraction schema per OpenAPI:
 *   { id, taxpayer, extractor, options, status, startedAt, finishedAt,
 *     rateLimitedAt, errorCode, createdDataPoints, updatedDataPoints,
 *     createdAt, updatedAt }
 *
 * We need taxpayer_rfc + odoo_company_id non-null because syntage_extractions
 * has NOT NULL constraints on those. ctx supplies them.
 */
export async function handleExtractionEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  // Upsert the taxpayer first — syntage_extractions has FK to syntage_taxpayers.
  // The Extraction payload embeds the full Taxpayer object inline.
  await upsertTaxpayerFromEvent(ctx, obj.taxpayer);

  const createdDP = typeof obj.createdDataPoints === "number" ? obj.createdDataPoints : 0;
  const updatedDP = typeof obj.updatedDataPoints === "number" ? obj.updatedDataPoints : 0;

  const row: Record<string, unknown> = {
    syntage_id:       obj.id ?? obj["@id"],
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    extractor_type:   obj.extractor ?? "unknown",
    options:          obj.options ?? {},
    status:           obj.status ?? "pending",
    started_at:       obj.startedAt ?? null,
    finished_at:      obj.finishedAt ?? null,
    rows_produced:    createdDP + updatedDP,
    error:            obj.errorCode ?? null,
    raw_payload:      obj,
    updated_at:       new Date().toISOString(),
  };

  if (!row.syntage_id) {
    throw new Error("extraction event missing id");
  }

  const { error } = await ctx.supabase
    .from("syntage_extractions")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}

/**
 * Upserts a syntage_taxpayers row from an embedded Taxpayer object.
 * Ensures FK constraints (e.g. syntage_extractions.taxpayer_rfc) are satisfied.
 * Idempotent via ON CONFLICT on rfc PK.
 */
async function upsertTaxpayerFromEvent(ctx: HandlerCtx, taxpayer: unknown): Promise<void> {
  if (!taxpayer || typeof taxpayer !== "object") return;
  const t = taxpayer as { id?: string; name?: string; personType?: string; registrationDate?: string };
  const rfc = t.id ?? ctx.taxpayerRfc;
  if (!rfc) return;

  const row: Record<string, unknown> = {
    rfc,
    person_type:        t.personType ?? null,
    name:               t.name ?? null,
    registration_date:  t.registrationDate
                          ? String(t.registrationDate).slice(0, 10)
                          : null,
    raw_payload:        t,
    updated_at:         new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_taxpayers")
    .upsert(row, { onConflict: "rfc" });
  if (error) throw error;
}

/**
 * Handles file.created events. Stores metadata; binary download happens in a
 * separate worker (Phase 3+).
 *
 * Syntage's real File schema per OpenAPI:
 *   { id, type, resource, mimeType, extension, size, filename,
 *     createdAt, updatedAt }
 *
 * Notably: no downloadUrl in the webhook — content is fetched via
 * GET /files/{id}/download. The taxpayerId is not on File either; we populate
 * from ctx (the webhook envelope's taxpayer).
 */
export async function handleFileCreatedEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:                  obj.id ?? obj["@id"],
    taxpayer_rfc:                ctx.taxpayerRfc,
    odoo_company_id:             ctx.odooCompanyId,
    file_type:                   obj.type ?? "unknown",
    filename:                    obj.filename ?? null,
    mime_type:                   obj.mimeType ?? null,
    size_bytes:                  obj.size ?? null,
    storage_path:                null, // populated later by download worker
    download_url_cached_until:   null, // not provided by Syntage webhook
    raw_payload:                 obj,
  };

  if (!row.syntage_id) {
    throw new Error("file.created event missing id");
  }

  const { error } = await ctx.supabase
    .from("syntage_files")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
