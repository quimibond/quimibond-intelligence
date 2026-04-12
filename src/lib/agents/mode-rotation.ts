import type { SupabaseClient } from "@supabase/supabase-js";

const MEMORY_TYPE = "mode_rotation";

export async function getNextMode(
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

  await supabase.from("agent_memory").upsert(
    {
      id: existing?.id,
      agent_id: agentId,
      memory_type: MEMORY_TYPE,
      content: nextMode,
      importance: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  return nextMode;
}
