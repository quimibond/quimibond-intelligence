import { getServiceClient } from "@/lib/supabase-server";
import { resolveEntity, supabaseEntityMapStore } from "@/lib/syntage/entity-resolver";
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";
import { handleInvoiceEvent } from "@/lib/syntage/handlers/invoice";
import { handleInvoiceLineItemEvent } from "@/lib/syntage/handlers/invoice-line-item";
import { handleInvoicePaymentEvent } from "@/lib/syntage/handlers/invoice-payment";
import { handleTaxRetentionEvent } from "@/lib/syntage/handlers/tax-retention";
import { handleTaxReturnEvent } from "@/lib/syntage/handlers/tax-return";

/**
 * Pull-based sync for Syntage resources.
 *
 * Why this exists: Syntage webhooks only fire on NEW or CHANGED entities. If
 * an entity already exists in their backend (from a previous extraction), a
 * subsequent extraction doesn't re-emit its webhook. That leaves our mirror
 * missing rows even though Syntage has them.
 *
 * This module queries Syntage's REST API (GET /entities/{id}/{resource})
 * paginated, and runs each result through the same handler used for webhooks.
 * The handler performs its normal upsert, so the mirror converges on Syntage's
 * state regardless of event history.
 *
 * Idempotency: fake webhook-event ids are generated per-pull and ignored on
 * syntage_invoices.syntage_id (PK) conflicts. Safe to run as many times as
 * needed.
 *
 * Pagination: Syntage uses cursor-based (hydra:view.hydra:next). We stop when
 * either maxPages is reached or there is no next cursor. Callers can chain by
 * re-calling with the returned `nextCursor`.
 */

const API_BASE = process.env.SYNTAGE_API_BASE ?? "https://api.syntage.com";

interface SyntageListResponse {
  "hydra:member"?: Array<Record<string, unknown>>;
  "hydra:totalItems"?: number;
  "hydra:view"?: {
    "hydra:next"?: string;
    "@id"?: string;
  };
}

export interface PullSyncResult {
  resource: string;
  entity_id: string;
  pages_fetched: number;
  items_fetched: number;
  items_upserted: number;
  items_errored: number;
  next_cursor: string | null;
  finished: boolean;
  elapsed_ms: number;
  errors: Array<{ id: string; message: string }>;
}

export type PullResource =
  | "invoices"
  | "invoice-line-items"
  | "invoice-payments"
  | "tax-retentions"
  | "tax-returns";

export interface PullSyncOptions {
  resource: PullResource;
  entityId: string;              // Syntage entity UUID (not RFC)
  taxpayerRfc: string;           // used for row context
  odooCompanyId: number;
  periodFrom?: string;           // YYYY-MM-DD
  periodTo?: string;             // YYYY-MM-DD
  cursor?: string | null;        // continue from previous page
  maxPages?: number;             // default 50 (≈5000 items)
  pageSize?: number;             // default 100
  softTimeoutMs?: number;        // stop early if exceeded (default 25000)
  isIssuer?: boolean | null;     // only for invoices: filter emitter=taxpayer
  isReceiver?: boolean | null;   // only for invoices: filter receiver=taxpayer
}

/**
 * Maps our internal resource name to the Syntage URL path.
 * Most resources are entity-scoped, but invoice-payments is TOP-LEVEL
 * (GET /invoices/payments) — not /entities/{id}/invoice-payments.
 */
function pathForResource(resource: PullResource, entityId: string): string {
  switch (resource) {
    case "invoices":
      return `/entities/${entityId}/invoices`;
    case "invoice-line-items":
      return `/entities/${entityId}/invoices/line-items`;
    case "invoice-payments":
      return `/invoices/payments`;
    case "tax-retentions":
      return `/entities/${entityId}/tax-retentions`;
    case "tax-returns":
      return `/entities/${entityId}/tax-returns`;
  }
}

export async function runPullSync(opts: PullSyncOptions): Promise<PullSyncResult> {
  const start = Date.now();
  const apiKey = process.env.SYNTAGE_API_KEY;
  if (!apiKey) throw new Error("SYNTAGE_API_KEY not set");

  const maxPages = opts.maxPages ?? 50;
  const pageSize = opts.pageSize ?? 100;
  const softTimeoutMs = opts.softTimeoutMs ?? 25000;

  const supabase = getServiceClient();
  const ctx: HandlerCtx = {
    supabase,
    odooCompanyId: opts.odooCompanyId,
    taxpayerRfc: opts.taxpayerRfc,
  };

  const handler = pickHandler(opts.resource);
  const eventType = eventTypeFor(opts.resource);

  let cursor: string | null = opts.cursor ?? null;
  let firstUrl: string;

  if (cursor) {
    // Cursor is already a full path (e.g. "/entities/{id}/invoices?page=2").
    firstUrl = `${API_BASE}${cursor}`;
  } else {
    const qs = new URLSearchParams();
    qs.set("itemsPerPage", String(pageSize));
    // Syntage uses `issuedAt[after]/[before]` for date filtering on invoices &
    // tax-retentions (NOT `period[from]/[to]` which is extraction-option style).
    if (opts.periodFrom) qs.set("issuedAt[after]", opts.periodFrom);
    if (opts.periodTo) qs.set("issuedAt[before]", opts.periodTo);
    // Invoice role filter: only applies to the invoices resource.
    if (opts.resource === "invoices") {
      if (opts.isIssuer != null) qs.set("isIssuer", String(opts.isIssuer));
      if (opts.isReceiver != null) qs.set("isReceiver", String(opts.isReceiver));
    }
    firstUrl = `${API_BASE}${pathForResource(opts.resource, opts.entityId)}?${qs.toString()}`;
  }

  const result: PullSyncResult = {
    resource: opts.resource,
    entity_id: opts.entityId,
    pages_fetched: 0,
    items_fetched: 0,
    items_upserted: 0,
    items_errored: 0,
    next_cursor: null,
    finished: false,
    elapsed_ms: 0,
    errors: [],
  };

  let currentUrl: string | null = firstUrl;

  while (currentUrl && result.pages_fetched < maxPages) {
    if (Date.now() - start > softTimeoutMs) {
      // Soft timeout: return nextCursor so caller can continue.
      result.next_cursor = extractRelativePath(currentUrl);
      break;
    }

    const res: Response = await fetch(currentUrl, {
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/ld+json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Syntage API ${res.status} on ${currentUrl}: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as SyntageListResponse;
    result.pages_fetched++;
    const items = json["hydra:member"] ?? [];
    result.items_fetched += items.length;

    for (const item of items) {
      const itemId = (item.id as string) ?? (item["@id"] as string) ?? "(unknown)";
      try {
        const fakeEvent: SyntageEvent = {
          id: `pull:${opts.resource}:${itemId}:${start}`,
          type: eventType,
          taxpayer: { id: opts.taxpayerRfc },
          data: { object: item },
          createdAt: new Date().toISOString(),
        };
        await handler(ctx, fakeEvent);
        result.items_upserted++;
      } catch (err) {
        result.items_errored++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ id: itemId, message: msg });
        // Don't abort; log and continue.
      }
    }

    const next = json["hydra:view"]?.["hydra:next"];
    currentUrl = next ? `${API_BASE}${next}` : null;

    if (!currentUrl) {
      result.finished = true;
      break;
    }
  }

  if (!result.finished && !result.next_cursor && currentUrl) {
    result.next_cursor = extractRelativePath(currentUrl);
  }

  result.elapsed_ms = Date.now() - start;
  return result;
}

/**
 * Resolves Syntage entity UUID from the taxpayer RFC via syntage_entity_map +
 * a lookup against Syntage's own entities endpoint.
 *
 * Entities in Syntage are separate from taxpayers — the entity wraps the
 * taxpayer with a credential and a link. Pull endpoints scope by entityId.
 */
export async function resolveSyntageEntityId(taxpayerRfc: string): Promise<{ entityId: string; odooCompanyId: number }> {
  const supabase = getServiceClient();
  const map = await resolveEntity(supabaseEntityMapStore(supabase), taxpayerRfc);
  if (!map) throw new Error(`Taxpayer ${taxpayerRfc} not in syntage_entity_map`);

  const apiKey = process.env.SYNTAGE_API_KEY;
  if (!apiKey) throw new Error("SYNTAGE_API_KEY not set");

  const res = await fetch(
    `${API_BASE}/entities?taxpayer=${encodeURIComponent("/taxpayers/" + taxpayerRfc)}`,
    { headers: { "X-API-Key": apiKey, "Accept": "application/ld+json" } },
  );
  if (!res.ok) throw new Error(`Syntage entities lookup failed: ${res.status}`);
  const body = await res.json() as SyntageListResponse;
  const first = body["hydra:member"]?.[0];
  const entityId = first?.id as string | undefined;
  if (!entityId) throw new Error(`No Syntage entity found for taxpayer ${taxpayerRfc}`);
  return { entityId, odooCompanyId: map.odooCompanyId };
}

function pickHandler(resource: PullResource): (ctx: HandlerCtx, event: SyntageEvent) => Promise<void> {
  switch (resource) {
    case "invoices":              return handleInvoiceEvent;
    case "invoice-line-items":    return handleInvoiceLineItemEvent;
    case "invoice-payments":      return handleInvoicePaymentEvent;
    case "tax-retentions":        return handleTaxRetentionEvent;
    case "tax-returns":           return handleTaxReturnEvent;
  }
}

function eventTypeFor(resource: PullResource): string {
  switch (resource) {
    case "invoices":              return "invoice.updated";
    case "invoice-line-items":    return "invoice_line_item.updated";
    case "invoice-payments":      return "invoice_payment.updated";
    case "tax-retentions":        return "tax_retention.updated";
    case "tax-returns":           return "tax_return.updated";
  }
}

function extractRelativePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
