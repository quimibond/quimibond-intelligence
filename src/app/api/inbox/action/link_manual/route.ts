/**
 * POST /api/inbox/action/link_manual
 * Inserts a manual override into mdm_manual_overrides and optionally appends a manual_notes entry.
 *
 * Body: {
 *   entity_type: string,        -- mdm_manual_overrides.entity_type
 *   canonical_id: string,       -- mdm_manual_overrides.canonical_id
 *   override_field: string,
 *   override_value: string,
 *   override_source: string,    -- origin label (e.g. "ceo_inbox")
 *   action?: string,
 *   source_link_id?: number,
 *   payload?: object,
 *   linked_by?: string,
 *   note?: string,
 *   -- optional manual_notes fields (for annotation):
 *   canonical_entity_type?: string,   -- defaults to entity_type
 *   canonical_entity_id?: string,     -- defaults to canonical_id
 * }
 *
 * Writes: mdm_manual_overrides, manual_notes — SP3 MDM + SP4 evidence layer.
 * No banned §12 reads.
 *
 * Schema drift (verified 2026-04-21):
 *   - mdm_manual_overrides uses entity_type + canonical_id (NOT canonical_entity_type/id).
 *   - linked_by (nullable text) is the operator column (NOT created_by).
 *   - linked_at is NOT NULL — must supply a value.
 *   - override_source is NOT NULL.
 *   - is_active is NOT NULL (default true assumed; pass explicitly).
 *   - manual_notes body column = "body" (NOT "content").
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const {
    entity_type,
    canonical_id,
    override_field,
    override_value,
    override_source,
    action,
    source_link_id,
    payload,
    linked_by,
    note,
    // optional — for manual_notes annotation; fall back to entity_type/canonical_id
    canonical_entity_type,
    canonical_entity_id,
  } = body as Record<string, unknown>;

  if (
    !entity_type ||
    !canonical_id ||
    !override_field ||
    !override_value ||
    !override_source
  ) {
    return NextResponse.json(
      {
        error:
          "entity_type, canonical_id, override_field, override_value, override_source required",
      },
      { status: 400 }
    );
  }

  const sb = getServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("mdm_manual_overrides")
    .insert({
      entity_type,
      canonical_id,
      override_field,
      override_value,
      override_source,
      action: action ?? null,
      source_link_id: source_link_id ?? null,
      payload: payload ?? {},
      linked_by: (linked_by as string) ?? "ceo_inbox",
      linked_at: now,
      is_active: true,
    })
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (note) {
    const noteEntityType = (canonical_entity_type as string) ?? (entity_type as string);
    const noteEntityId = (canonical_entity_id as string) ?? (canonical_id as string);
    await sb.from("manual_notes").insert({
      canonical_entity_type: noteEntityType,
      canonical_entity_id: noteEntityId,
      note_type: "manual_link",
      body: note,
      created_by: (linked_by as string) ?? "ceo_inbox",
    });
  }

  return NextResponse.json({ ok: true, override: data });
}
