/**
 * Identity Resolution Agent
 *
 * Resolves the gap where external contacts have no odoo_partner_id link
 * and companies extracted from emails are disconnected from Odoo companies.
 *
 * Steps:
 * 1. Link contacts to companies by email domain
 * 2. Inherit odoo_partner_id from company to contacts
 * 3. Link companies to entities by fuzzy name match (pg_trgm)
 * 4. Link contacts to companies by odoo_partner_id
 * 5. Link contacts to entities by email
 * 6. Fill missing company domains
 * 7. Link orphan emails to companies via sender contact
 *
 * Runs every 2 hours via Vercel cron. Idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}

async function handler(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  try {
    // Get before-stats (non-blocking — don't fail if this errors)
    let gapsBefore = null;
    try {
      const { data } = await supabase.rpc("get_identity_gaps");
      gapsBefore = data;
    } catch { /* ignore */ }

    // Run identity resolution with statement timeout to prevent long locks
    const { data: result, error: resolveErr } = await supabase.rpc(
      "resolve_identities"
    );

    if (resolveErr) {
      console.error("[identity-resolution] resolve_identities error:", resolveErr.message, resolveErr.code, resolveErr.details);
      return NextResponse.json(
        { error: "resolve_identities failed", details: resolveErr.message, code: resolveErr.code },
        { status: 500 }
      );
    }

    // Get after-stats (non-blocking)
    let gapsAfter = null;
    try {
      const { data } = await supabase.rpc("get_identity_gaps");
      gapsAfter = data;
    } catch { /* ignore */ }

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

    try {
      await supabase.from("pipeline_logs").insert({
        level: "error",
        phase: "identity_resolution",
        message: `Identity resolution failed: ${String(err)}`,
        details: { error: String(err) },
      });
    } catch { /* ignore logging errors */ }

    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
