/**
 * Company enrichment worker — runs enrich_companies() RPC.
 *
 * Fills in missing domain, rfc, entity_id on companies using data
 * from contacts, CFDIs, and odoo sync tables.
 *
 * Cron: every 4 hours.
 */
import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const supabase = getServiceClient();

  try {
    const { data, error } = await supabase.rpc("enrich_companies");
    if (error) {
      console.error("[enrich-companies] RPC error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log result
    const result = data as Record<string, unknown>;
    if ((result?.total_enriched as number) > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "company_enrichment",
        message: `Company enrichment: ${result.total_enriched} fields updated`,
        details: result,
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[enrich-companies]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
