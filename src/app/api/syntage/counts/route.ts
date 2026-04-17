import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { countSyntageResource, resolveSyntageEntityId, type PullResource } from "@/lib/syntage/pull-sync";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint: asks Syntage directly how many items it has per resource
 * for the entity, broken down by isIssuer / isReceiver.
 *
 * This is the factual answer to "what does Syntage actually have". Use it to
 * set expectations before running a pull-sync.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://quimibond-intelligence.vercel.app/api/syntage/counts?taxpayer=PNT920218IW5"
 */
export async function GET(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const taxpayerRfc = url.searchParams.get("taxpayer") ?? "PNT920218IW5";
  const entityIdOverride = url.searchParams.get("entityId");

  try {
    const entityId = entityIdOverride
      ?? (await resolveSyntageEntityId(taxpayerRfc)).entityId;

    const resources: PullResource[] = [
      "invoices",
      "invoice-line-items",
      "invoice-payments",
      "tax-retentions",
      "tax-returns",
    ];

    const counts: Record<string, Record<string, number>> = {};

    await Promise.all(resources.map(async r => {
      const row: Record<string, number> = {};
      row["total"] = await countSyntageResource(r, entityId);
      if (r === "invoices") {
        row["issued"] = await countSyntageResource(r, entityId, { isIssuer: true });
        row["received"] = await countSyntageResource(r, entityId, { isReceiver: true });
      }
      counts[r] = row;
    }));

    return NextResponse.json({ ok: true, taxpayer: taxpayerRfc, entity_id: entityId, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
