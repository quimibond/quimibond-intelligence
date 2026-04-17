import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";

// invoices_unified refresh ~14s @ 70k rows. Payments + network overhead → necesitamos
// budget generoso. Vercel Pro permite hasta 300s. 60s cubre hasta ~4x el dataset actual.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Manual trigger for Layer 3 refresh.
 *
 * Usage:
 *   POST /api/syntage/refresh-unified
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Returns the JSON results of both refresh_invoices_unified() and
 * refresh_payments_unified(). Normally these run via pg_cron every 15min;
 * this endpoint is for manual trigger (e.g. from /system UI button or
 * after a large backfill).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = validatePipelineAuth(request);
  if (authError) return authError as NextResponse;

  const supabase = getServiceClient();

  const { data: invoicesResult, error: invoicesError } = await supabase.rpc(
    "refresh_invoices_unified"
  );
  if (invoicesError) {
    return NextResponse.json(
      { ok: false, error: `refresh_invoices_unified failed: ${invoicesError.message}` },
      { status: 500 }
    );
  }

  const { data: paymentsResult, error: paymentsError } = await supabase.rpc(
    "refresh_payments_unified"
  );
  if (paymentsError) {
    return NextResponse.json(
      {
        ok: false,
        error: `refresh_payments_unified failed: ${paymentsError.message}`,
        invoices: invoicesResult,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    invoices: invoicesResult,
    payments: paymentsResult,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request);
}
