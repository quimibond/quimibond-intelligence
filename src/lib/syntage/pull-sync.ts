import { getServiceClient } from "@/lib/supabase-server";
import { resolveEntity, supabaseEntityMapStore } from "@/lib/syntage/entity-resolver";
import {
  mapInvoice,
  mapInvoiceLineItem,
  mapInvoicePayment,
  mapTaxRetention,
  mapTaxReturn,
  type MapperCtx,
} from "@/lib/syntage/mappers";

/**
 * Pull-based sync for Syntage resources.
 *
 * Why this exists: Syntage webhooks only fire on NEW or CHANGED entities. If
 * an entity already exists in their backend (from a previous extraction), a
 * subsequent extraction doesn't re-emit its webhook. That leaves our mirror
 * missing rows even though Syntage has them.
 *
 * This module queries Syntage's REST API (GET /entities/{id}/{resource})
 * paginated, and batch-upserts the rows to our mirror tables.
 *
 * Idempotency: upsert-on-conflict(syntage_id). Safe to run as many times as
 * needed.
 *
 * Pagination: Cursor-based (X-Pagination-Style: cursor). We stop on either:
 *   - no hydra:next in response (finished=true)
 *   - soft timeout hit (return next_cursor so caller can continue)
 *   - maxPages reached
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

/**
 * Diagnostic: returns Syntage's reported totalItems for a resource+filter combo,
 * without iterating.
 */
export async function countSyntageResource(
  resource: PullResource,
  entityId: string,
  opts: { isIssuer?: boolean | null; isReceiver?: boolean | null; periodFrom?: string; periodTo?: string } = {},
): Promise<number> {
  const apiKey = process.env.SYNTAGE_API_KEY;
  if (!apiKey) throw new Error("SYNTAGE_API_KEY not set");

  const qs = new URLSearchParams();
  qs.set("itemsPerPage", "1");
  if (opts.periodFrom) qs.set("issuedAt[after]", opts.periodFrom);
  if (opts.periodTo) qs.set("issuedAt[before]", opts.periodTo);
  if (resource === "invoices") {
    if (opts.isIssuer != null) qs.set("isIssuer", String(opts.isIssuer));
    if (opts.isReceiver != null) qs.set("isReceiver", String(opts.isReceiver));
  }

  const res = await fetch(
    `${API_BASE}${pathForResource(resource, entityId)}?${qs.toString()}`,
    {
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/ld+json",
        "X-Pagination-Enable-Partial": "0",
      },
    },
  );
  if (!res.ok) throw new Error(`Syntage count ${res.status} on ${resource}: ${await res.text()}`);
  const body = (await res.json()) as SyntageListResponse;
  return body["hydra:totalItems"] ?? 0;
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
  entityId: string;
  taxpayerRfc: string;
  odooCompanyId: number;
  periodFrom?: string;
  periodTo?: string;
  cursor?: string | null;
  maxPages?: number;
  pageSize?: number;
  softTimeoutMs?: number;
  isIssuer?: boolean | null;
  isReceiver?: boolean | null;
}

/**
 * Per-resource config: URL path, destination table, conflict key, and
 * pure row mapper.
 */
interface ResourceConfig {
  path: (entityId: string) => string;
  table: string;
  conflictKey: string;
  mapRow: (obj: Record<string, unknown>, ctx: MapperCtx) => Record<string, unknown>;
}

const RESOURCE_BATCH_CONFIG: Record<PullResource, ResourceConfig> = {
  "invoices": {
    path: id => `/entities/${id}/invoices`,
    table: "syntage_invoices",
    conflictKey: "syntage_id",
    mapRow: mapInvoice,
  },
  "invoice-line-items": {
    path: id => `/entities/${id}/invoices/line-items`,
    table: "syntage_invoice_line_items",
    conflictKey: "syntage_id",
    mapRow: mapInvoiceLineItem,
  },
  "invoice-payments": {
    path: () => `/invoices/payments`,  // top-level, not entity-scoped
    table: "syntage_invoice_payments",
    conflictKey: "syntage_id",
    mapRow: mapInvoicePayment,
  },
  "tax-retentions": {
    path: id => `/entities/${id}/tax-retentions`,
    table: "syntage_tax_retentions",
    conflictKey: "syntage_id",
    mapRow: mapTaxRetention,
  },
  "tax-returns": {
    path: id => `/entities/${id}/tax-returns`,
    table: "syntage_tax_returns",
    conflictKey: "syntage_id",
    mapRow: mapTaxReturn,
  },
};

function pathForResource(resource: PullResource, entityId: string): string {
  return RESOURCE_BATCH_CONFIG[resource].path(entityId);
}

export async function runPullSync(opts: PullSyncOptions): Promise<PullSyncResult> {
  const start = Date.now();
  const apiKey = process.env.SYNTAGE_API_KEY;
  if (!apiKey) throw new Error("SYNTAGE_API_KEY not set");

  const maxPages = opts.maxPages ?? 50;
  const pageSize = opts.pageSize ?? 100;
  const softTimeoutMs = opts.softTimeoutMs ?? 25000;

  const supabase = getServiceClient();
  const mapperCtx: MapperCtx = {
    odooCompanyId: opts.odooCompanyId,
    taxpayerRfc: opts.taxpayerRfc,
  };
  const cfg = RESOURCE_BATCH_CONFIG[opts.resource];

  let cursor: string | null = opts.cursor ?? null;
  let firstUrl: string;

  if (cursor) {
    firstUrl = `${API_BASE}${cursor}`;
  } else {
    const qs = new URLSearchParams();
    qs.set("itemsPerPage", String(pageSize));
    if (opts.periodFrom) qs.set("issuedAt[after]", opts.periodFrom);
    if (opts.periodTo) qs.set("issuedAt[before]", opts.periodTo);
    if (opts.resource === "invoices") {
      if (opts.isIssuer != null) qs.set("isIssuer", String(opts.isIssuer));
      if (opts.isReceiver != null) qs.set("isReceiver", String(opts.isReceiver));
    }
    firstUrl = `${API_BASE}${cfg.path(opts.entityId)}?${qs.toString()}`;
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
      result.next_cursor = extractRelativePath(currentUrl);
      break;
    }

    const res: Response = await fetch(currentUrl, {
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/ld+json",
        "X-Pagination-Style": "cursor",
        "X-Pagination-Enable-Partial": "0",
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

    // Map all items to rows (pure, no DB calls). Collect errors inline.
    const rows: Record<string, unknown>[] = [];
    for (const item of items) {
      const itemId = (item.id as string) ?? (item["@id"] as string) ?? "(unknown)";
      try {
        rows.push(cfg.mapRow(item, mapperCtx));
      } catch (err) {
        result.items_errored++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ id: itemId, message: msg });
      }
    }

    // ONE batch upsert per page. 100x fewer Supabase round-trips than the
    // per-item pattern used by webhook handlers.
    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from(cfg.table)
        .upsert(rows, { onConflict: cfg.conflictKey });

      if (upsertErr) {
        // Fall back to per-row so a single bad row doesn't lose the batch.
        for (const row of rows) {
          const rowId = String(row[cfg.conflictKey] ?? "(unknown)");
          const { error: singleErr } = await supabase
            .from(cfg.table)
            .upsert(row, { onConflict: cfg.conflictKey });
          if (singleErr) {
            result.items_errored++;
            result.errors.push({ id: rowId, message: singleErr.message });
          } else {
            result.items_upserted++;
          }
        }
      } else {
        result.items_upserted += rows.length;
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

function extractRelativePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
