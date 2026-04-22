/**
 * POST /api/inbox/action/operationalize
 * Enqueues an "operationalize" command into sync_commands and appends a manual_notes entry.
 *
 * Body: { issue_id: string (uuid), note?: string }
 *
 * Reads: reconciliation_issues — silver layer.
 * Writes: sync_commands, manual_notes — silver/evidence layer.
 * No banned §12 reads.
 *
 * Schema drift (verified 2026-04-21):
 *   - reconciliation_issues PK = issue_id (uuid)
 *   - sync_commands: only "command" (text NOT NULL) and "requested_by" (nullable) are user-settable;
 *     "status" defaults to 'pending', "id"/"created_at" have DB defaults. No "payload" column.
 *   - manual_notes body column = "body" (NOT "content")
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { issue_id, note } = body as { issue_id?: string; note?: string };

  if (!issue_id) {
    return NextResponse.json({ error: "issue_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: issue } = await sb
    .from("reconciliation_issues")
    .select("canonical_entity_type, canonical_entity_id")
    .eq("issue_id", issue_id)
    .maybeSingle();

  if (!issue) {
    return NextResponse.json({ error: "issue_id not found" }, { status: 404 });
  }

  // Encode context in the command string since sync_commands has no payload column
  const commandStr = `operationalize:${issue_id}:${issue.canonical_entity_type ?? ""}:${issue.canonical_entity_id ?? ""}`;

  await sb.from("sync_commands").insert({
    command: commandStr,
    requested_by: "ceo_inbox",
  });

  await sb.from("manual_notes").insert({
    canonical_entity_type: issue.canonical_entity_type,
    canonical_entity_id: issue.canonical_entity_id,
    note_type: "operationalize_requested",
    body: note ?? "CEO marked for operationalization",
    created_by: "ceo_inbox",
  });

  return NextResponse.json({ ok: true, queued: true });
}
