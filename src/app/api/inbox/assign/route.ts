/**
 * POST /api/inbox/assign
 * Assigns a reconciliation_issues row to a canonical contact and records assigned_at.
 *
 * Body: { issue_id: string (uuid), assignee_canonical_contact_id: number }
 *
 * Reads/writes: reconciliation_issues — SP4 silver layer.
 * No banned §12 reads.
 *
 * Schema drift (verified 2026-04-21):
 *   - reconciliation_issues PK = issue_id (uuid)
 *   - assigned_at added via migration 1064a_silver_sp5_inbox_columns
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { issue_id, assignee_canonical_contact_id } = body as {
    issue_id?: string;
    assignee_canonical_contact_id?: number;
  };

  if (!issue_id || !assignee_canonical_contact_id) {
    return NextResponse.json(
      { error: "issue_id and assignee_canonical_contact_id required" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  const { data, error } = await sb
    .from("reconciliation_issues")
    .update({
      assignee_canonical_contact_id,
      assigned_at: new Date().toISOString(),
    })
    .eq("issue_id", issue_id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "issue_id not found" }, { status: 404 });

  return NextResponse.json({ ok: true, issue: data });
}
