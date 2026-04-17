import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { runPullSync, resolveSyntageEntityId, type PullResource } from "@/lib/syntage/pull-sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const VALID_RESOURCES: PullResource[] = [
  "invoices",
  "invoice-line-items",
  "invoice-payments",
  "tax-retentions",
  "tax-returns",
];

/**
 * Admin endpoint to pull-sync a resource directly from Syntage REST API.
 *
 * Usage:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://quimibond-intelligence.vercel.app/api/syntage/pull-sync?resource=invoices&from=2024-01-01&to=2024-12-31"
 *
 *   # Continue from where previous call left off (cursor in response):
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://quimibond-intelligence.vercel.app/api/syntage/pull-sync?resource=invoices&cursor=/entities/abc/invoices?page=2"
 *
 * Parameters:
 *   resource   (required) — invoices | invoice-line-items | invoice-payments
 *                           | tax-retentions | tax-returns
 *   taxpayer   (optional) — default PNT920218IW5
 *   from       (optional) — YYYY-MM-DD period start
 *   to         (optional) — YYYY-MM-DD period end
 *   cursor     (optional) — continue from previous page
 *   maxPages   (optional) — default 50
 *   pageSize   (optional) — default 100
 */
export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const params = url.searchParams;

  const cursorParam = params.get("cursor");

  // If cursor is provided, derive resource from the URL path inside it
  // (e.g. "/entities/xxx/invoices?page=2" → "invoices").
  let resource = params.get("resource") as PullResource | null;
  if (!resource && cursorParam) {
    const match = cursorParam.match(/\/entities\/[^/]+\/([^?]+)/);
    if (match) resource = match[1] as PullResource;
  }

  if (!resource || !VALID_RESOURCES.includes(resource)) {
    return NextResponse.json({
      error: "resource param is required (or cursor with /entities/xxx/{resource})",
      valid: VALID_RESOURCES,
    }, { status: 400 });
  }

  const taxpayerRfc = params.get("taxpayer") ?? "PNT920218IW5";
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const cursor = cursorParam ?? null;
  const maxPages = Number(params.get("maxPages") ?? "50");
  const pageSize = Number(params.get("pageSize") ?? "100");
  const parseBool = (v: string | null): boolean | null => {
    if (v == null) return null;
    const s = v.toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return null;
  };
  const isIssuer = parseBool(params.get("isIssuer"));
  const isReceiver = parseBool(params.get("isReceiver"));
  const entityIdOverride = params.get("entityId");

  try {
    // Resolve entity via Syntage API, but allow caller to override — the default
    // resolver picks the first entity returned by /entities?taxpayer=..., which
    // may not be the one holding the credential/data for this taxpayer when the
    // org has multiple entities for the same RFC.
    const resolved = await resolveSyntageEntityId(taxpayerRfc);
    const entityId = entityIdOverride ?? resolved.entityId;
    const odooCompanyId = resolved.odooCompanyId;

    const result = await runPullSync({
      resource,
      entityId,
      taxpayerRfc,
      odooCompanyId,
      periodFrom: from,
      periodTo: to,
      cursor,
      maxPages: Number.isFinite(maxPages) ? maxPages : 50,
      pageSize: Number.isFinite(pageSize) ? pageSize : 100,
      softTimeoutMs: 50000, // leave 10s buffer before Vercel hard timeout (60s)
      isIssuer,
      isReceiver,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[syntage/pull-sync] error:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
