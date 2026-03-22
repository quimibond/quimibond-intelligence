import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// Lazy proxy so `supabase.from(...)` works without calling getSupabaseClient() everywhere
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = getSupabaseClient();
    const val = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? (val as (...args: unknown[]) => unknown).bind(client) : val;
  },
});
