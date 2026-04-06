/**
 * Identity Resolution Agent
 *
 * Resolves the gap where external contacts have no odoo_partner_id link
 * and companies extracted from emails are disconnected from Odoo companies.
 *
 * Steps:
 * 1. Link contacts to companies by email domain
 * 2. Link contacts to Odoo partners by email match
 * 3. Link companies to Odoo by fuzzy name match (pg_trgm)
 * 4. Link contacts to companies by odoo_partner_id
 * 5. Propagate commercial_partner_id
 * 6. Fill missing company domains
 *
 * Runs every 2 hours via Vercel cron. Idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";
  const supabase = createClient(url, key);

  try {
    // Get before-stats
    const { data: gapsBefore, error: gapsBeforeErr } = await supabase.rpc(
      "get_identity_gaps"
    );
    if (gapsBeforeErr) {
      console.error("[identity-resolution] get_identity_gaps error:", gapsBeforeErr);
    }

    // Run identity resolution
    const { data: result, error: resolveErr } = await supabase.rpc(
      "resolve_identities"
    );

    if (resolveErr) {
      console.error("[identity-resolution] resolve_identities error:", resolveErr);
      return NextResponse.json(
        { error: "resolve_identities failed", details: resolveErr.message },
        { status: 500 }
      );
    }

    // Get after-stats
    const { data: gapsAfter } = await supabase.rpc("get_identity_gaps");

    const totalResolved = result?.total_resolved ?? 0;

    // Log results to pipeline_logs
    await supabase.from("pipeline_logs").insert({
      level: totalResolved > 0 ? "info" : "debug",
      phase: "identity_resolution",
      message: `Identity resolution: ${totalResolved} links resolved`,
      details: {
        result,
        gaps_before: gapsBefore,
        gaps_after: gapsAfter,
      },
    });

    return NextResponse.json({
      success: true,
      resolved: result,
      gaps_before: gapsBefore,
      gaps_after: gapsAfter,
    });
  } catch (err) {
    console.error("[identity-resolution] Error:", err);

    await supabase.from("pipeline_logs").insert({
      level: "error",
      phase: "identity_resolution",
      message: `Identity resolution failed: ${String(err)}`,
      details: { error: String(err) },
    }).catch(() => {});

    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
