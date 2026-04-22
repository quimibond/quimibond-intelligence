/**
 * GET /api/inbox/top
 * Returns prioritized CEO inbox items from gold_ceo_inbox view.
 * Reads: gold_ceo_inbox (SP4 gold layer — not in §12 drop list).
 * No banned §12 reads.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 50),
    100
  );
  const severity = req.nextUrl.searchParams.get("severity");

  let q = sb
    .from("gold_ceo_inbox")
    .select("*")
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (severity) q = q.eq("severity", severity);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
