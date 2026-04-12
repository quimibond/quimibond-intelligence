import type { SupabaseClient } from "@supabase/supabase-js";

const MEMORY_TYPE = "mode_rotation";

export async function advanceMode(
  supabase: SupabaseClient,
  agentId: number,
  modes: string[]
): Promise<string> {
  if (!modes.length) return "";

  const { data: existing } = await supabase
    .from("agent_memory")
    .select("id, content")
    .eq("agent_id", agentId)
    .eq("memory_type", MEMORY_TYPE)
    .maybeSingle();

  const currentIdx = existing?.content ? modes.indexOf(existing.content) : -1;
  const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % modes.length;
  const nextMode = modes[nextIdx];

  if (existing?.id) {
    const { error } = await supabase
      .from("agent_memory")
      .update({
        content: nextMode,
        importance: 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(`mode-rotation update failed: ${error.message}`);
  } else {
    const { error } = await supabase.from("agent_memory").insert({
      agent_id: agentId,
      memory_type: MEMORY_TYPE,
      content: nextMode,
      importance: 1,
    });
    if (error) throw new Error(`mode-rotation insert failed: ${error.message}`);
  }

  return nextMode;
}
