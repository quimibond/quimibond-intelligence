/**
 * POST /api/inbox/resolve
 * Marks a reconciliation_issues row as resolved and optionally appends a manual_notes entry.
 *
 * Body: { issue_id: string (uuid), resolution: string, note?: string }
 *
 * Reads/writes: reconciliation_issues, manual_notes — SP4 silver/evidence layer.
 * No banned §12 reads.
 *
 * Schema drift (verified 2026-04-21):
 *   - reconciliation_issues PK = issue_id (uuid)
 *   - manual_notes body column = "body" (NOT "content")
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { issue_id, resolution, note } = body as {
    issue_id?: string;
    resolution?: string;
    note?: string;
  };

  if (!issue_id || !resolution) {
    return NextResponse.json(
      { error: "issue_id and resolution required" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();
  const resolved_at = new Date().toISOString();

  const { data, error } = await sb
    .from("reconciliation_issues")
    .update({ resolved_at, resolution, resolution_note: note ?? null })
    .eq("issue_id", issue_id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "issue_id not found" }, { status: 404 });

  if (note) {
    await sb.from("manual_notes").insert({
      canonical_entity_type: data.canonical_entity_type,
      canonical_entity_id: data.canonical_entity_id,
      note_type: "resolution",
      body: note,
      created_by: "ceo_inbox",
    });
  }

  return NextResponse.json({ ok: true, issue: data });
}
