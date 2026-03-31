import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET() {
  try {
    const supabase = getServiceClient();

    // Step 1: Query
    console.log("[test] Step 1: Query emails");
    const { data: emails, error } = await supabase
      .from("emails")
      .select("id, account, sender_type")
      .eq("kg_processed", false)
      .gte("email_date", new Date(Date.now() - 14 * 86400_000).toISOString())
      .limit(10);

    if (error) return NextResponse.json({ step: 1, error: error.message });
    console.log(`[test] Step 1 OK: ${emails?.length} emails`);

    // Step 2: Import odoo-context
    console.log("[test] Step 2: Import odoo-context");
    const { buildOdooContext } = await import("@/lib/pipeline/odoo-context");
    console.log("[test] Step 2 OK: imported");

    // Step 3: Import claude-pipeline
    console.log("[test] Step 3: Import claude-pipeline");
    const { formatEmailsForClaude } = await import("@/lib/pipeline/claude-pipeline");
    console.log("[test] Step 3 OK: imported");

    // Step 4: Build context with empty array
    console.log("[test] Step 4: Build context");
    const ctx = await buildOdooContext(supabase, []);
    console.log("[test] Step 4 OK");

    // Step 5: Check ANTHROPIC_API_KEY
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    console.log(`[test] Step 5: API key = ${hasKey}`);

    return NextResponse.json({
      success: true,
      emails: emails?.length,
      hasOdooContext: !!ctx,
      hasApiKey: hasKey,
      formatExists: typeof formatEmailsForClaude === "function",
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    console.error("[test] FAILED:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
