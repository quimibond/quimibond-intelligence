"use server";

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { InsightState } from "@/lib/queries/intelligence/insights";

/**
 * Transición de estado de un insight.
 * new → seen → acted_on | dismissed | archived
 */
export async function setInsightState(
  id: number,
  state: InsightState
): Promise<{ ok: boolean; error?: string }> {
  const sb = getServiceClient();
  const { error } = await sb
    .from("agent_insights")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[setInsightState]", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/insight/${id}`);
  revalidatePath("/");
  return { ok: true };
}

/**
 * Mark seen: transición automática cuando el CEO abre el detalle.
 */
export async function markInsightSeen(id: number): Promise<void> {
  const sb = getServiceClient();
  // Solo transiciona si está en 'new'
  await sb
    .from("agent_insights")
    .update({ state: "seen", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("state", "new");
  revalidatePath("/inbox");
}

/**
 * Agrega una nota manual a una entidad canónica.
 */
export async function addManualNote(input: {
  canonical_entity_type: string;
  canonical_entity_id: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const body = input.body.trim();
  if (!body) {
    return { ok: false, error: "Nota vacía" };
  }
  if (!input.canonical_entity_type || !input.canonical_entity_id) {
    return { ok: false, error: "Entidad faltante" };
  }
  const sb = getServiceClient();
  const { error } = await sb.from("manual_notes").insert({
    canonical_entity_type: input.canonical_entity_type,
    canonical_entity_id: input.canonical_entity_id,
    body,
    note_type: "inbox_detail",
    created_by: "ceo", // TODO sp6-02+: thread real authenticated user
  });
  if (error) {
    console.error("[addManualNote]", error);
    return { ok: false, error: error.message };
  }
  revalidatePath("/inbox");
  return { ok: true };
}
