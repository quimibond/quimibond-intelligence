import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Admin endpoint to trigger Syntage extractions via API.
 *
 * Usage (GET/POST):
 *   /api/syntage/backfill?taxpayer=PNT920218IW5&extractor=invoice&from=2019-01-01&to=2026-04-16
 *
 * Parameters:
 *   taxpayer   — RFC. Default: PNT920218IW5.
 *   extractor  — one of: invoice, tax_retention, annual_tax_return,
 *                monthly_tax_return, electronic_accounting, tax_status,
 *                rif_tax_return, tax_compliance, buro_de_credito_report.
 *   from       — ISO date (YYYY-MM-DD). Default: 2019-01-01.
 *   to         — ISO date. Default: today.
 *   issued     — bool, default true (applies to invoice/tax_retention).
 *   received   — bool, default true (applies to invoice/tax_retention).
 *   types      — CSV. Default: "I,E,P,N,T" (applies to invoice).
 *   xml,pdf    — bool, default true (applies to invoice/tax_retention).
 *
 * Returns the created Extraction object from Syntage. Progress visible via
 * syntage_extractions table (populated by webhook events).
 */
export async function POST(request: NextRequest) {
  return handle(request);
}
export async function GET(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const apiKey = process.env.SYNTAGE_API_KEY;
  const apiBase = process.env.SYNTAGE_API_BASE ?? "https://api.syntage.com";
  if (!apiKey) {
    return NextResponse.json({ error: "SYNTAGE_API_KEY not set" }, { status: 503 });
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  // Allow JSON body to override query string params (for POST)
  let body: Record<string, unknown> = {};
  if (request.method === "POST") {
    try {
      const text = await request.text();
      if (text.trim().length > 0) body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const taxpayer = (body.taxpayer as string | undefined)
    ?? params.get("taxpayer")
    ?? "PNT920218IW5";

  const extractor = (body.extractor as string | undefined) ?? params.get("extractor");
  if (!extractor) {
    return NextResponse.json({
      error: "extractor is required",
      validExtractors: [
        "invoice", "tax_retention", "annual_tax_return", "monthly_tax_return",
        "electronic_accounting", "tax_status", "rif_tax_return",
        "tax_compliance", "buro_de_credito_report",
      ],
    }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const from = (body.from as string | undefined) ?? params.get("from") ?? "2019-01-01";
  const to = (body.to as string | undefined) ?? params.get("to") ?? today;

  const issued = parseBool(body.issued ?? params.get("issued"), true);
  const received = parseBool(body.received ?? params.get("received"), true);
  const xml = parseBool(body.xml ?? params.get("xml"), true);
  const pdf = parseBool(body.pdf ?? params.get("pdf"), true);
  const typesCsv = (body.types as string | undefined) ?? params.get("types") ?? "I,E,P,N,T";
  const types = typesCsv.split(",").map(s => s.trim()).filter(Boolean);

  const options = buildOptionsForExtractor(extractor, {
    from, to, issued, received, xml, pdf, types,
  });

  const syntageBody = {
    taxpayer: `/taxpayers/${taxpayer}`,
    extractor,
    options,
  };

  const syntageRes = await fetch(`${apiBase}/extractions`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/ld+json",
    },
    body: JSON.stringify(syntageBody),
  });

  const resText = await syntageRes.text();
  let resBody: unknown;
  try {
    resBody = JSON.parse(resText);
  } catch {
    resBody = resText;
  }

  if (!syntageRes.ok) {
    return NextResponse.json({
      ok: false,
      status: syntageRes.status,
      request: syntageBody,
      response: resBody,
    }, { status: syntageRes.status });
  }

  return NextResponse.json({
    ok: true,
    extraction: resBody,
    hint: "Track progress in public.syntage_extractions via the webhook handler",
  });
}

function parseBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return fallback;
}

function buildOptionsForExtractor(
  extractor: string,
  p: { from: string; to: string; issued: boolean; received: boolean; xml: boolean; pdf: boolean; types: string[] },
): Record<string, unknown> {
  const base = { period: { from: p.from, to: p.to } };

  switch (extractor) {
    case "invoice":
      return {
        ...base,
        issued: p.issued,
        received: p.received,
        xml: p.xml,
        pdf: p.pdf,
        types: p.types,
        complement: -1,
      };
    case "tax_retention":
      return {
        ...base,
        issued: p.issued,
        received: p.received,
        xml: p.xml,
        pdf: p.pdf,
        complement: -1,
      };
    case "monthly_tax_return":
    case "annual_tax_return":
    case "rif_tax_return":
    case "electronic_accounting":
      return base;
    case "tax_status":
    case "tax_compliance":
    case "buro_de_credito_report":
      // These extractors don't accept period; return empty options.
      return {};
    default:
      return base;
  }
}
