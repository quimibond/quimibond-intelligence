"use server";

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { InsightState } from "@/lib/queries/insights";

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
