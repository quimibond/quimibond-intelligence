/**
 * Employee Metrics — Weekly performance calculation.
 *
 * Calculates per-person metrics from emails, action_items, and Odoo activities.
 * Runs weekly (or on demand) via /api/pipeline/employee-metrics
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;  const supabase = getServiceClient();

  try {
    const { data, error } = await supabase.rpc("calculate_employee_metrics");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "employee_metrics",
      message: `Employee metrics: ${data?.employees_scored ?? 0} people scored`,
      details: data,
    });

    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error("[employee-metrics] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
