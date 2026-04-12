import { createClient, SupabaseClient, PostgrestError } from "@supabase/supabase-js";

let _serviceClient: SupabaseClient | null = null;
let _warnedAboutFallback = false;

/**
 * Server-side Supabase client using service role key (singleton).
 * Only use in API routes (server-side), never expose to client.
 *
 * Resolution order for the key:
 *   1. SUPABASE_SERVICE_KEY (legacy name)
 *   2. SUPABASE_SERVICE_ROLE_KEY (official Supabase name)
 *   3. SUPABASE_SECRET_KEY (alt name)
 *   4. NEXT_PUBLIC_SUPABASE_ANON_KEY (LAST RESORT — logs a warning)
 *
 * The fallback to ANON is a hidden trap: RLS will silently reject inserts
 * on tables without explicit INSERT policies. Always prefer a real service key.
 */
export function getServiceClient(): SupabaseClient {
  if (!_serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? (process.env.POSTGRES_HOST ? `https://${process.env.POSTGRES_HOST.replace('db.', '')}` : '');
    const serviceKey = process.env.SUPABASE_SERVICE_KEY
      ?? process.env.SUPABASE_SERVICE_ROLE_KEY
      ?? process.env.SUPABASE_SECRET_KEY;
    const key = serviceKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    if (!serviceKey && !_warnedAboutFallback) {
      _warnedAboutFallback = true;
      console.warn(
        "[supabase-server] WARNING: No SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY set. " +
        "Falling back to ANON key. Inserts on RLS-protected tables will fail silently " +
        "unless explicit INSERT policies exist. Set SUPABASE_SERVICE_ROLE_KEY in environment."
      );
    }
    _serviceClient = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return _serviceClient;
}

/**
 * Typed wrapper that throws on insert failures instead of returning empty data silently.
 * Use for any critical write path where a silent failure would hide a bug.
 *
 * @example
 *   const rows = await assertInsert(
 *     supabase.from("agent_insights").insert(payloads).select("id"),
 *     "agent_insights"
 *   );
 */
export async function assertInsert<T>(
  query: PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  tableName: string,
  expectedCount?: number
): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `[${tableName}] Insert failed: ${error.message} (code: ${error.code}, details: ${error.details ?? "none"})`
    );
  }
  if (!data || data.length === 0) {
    throw new Error(
      `[${tableName}] Insert returned empty data. This usually means RLS silently rejected the write. ` +
      `Check that the table has an INSERT policy for the current role, or use a service role key.`
    );
  }
  if (expectedCount !== undefined && data.length !== expectedCount) {
    console.warn(
      `[${tableName}] Insert returned ${data.length} rows, expected ${expectedCount}. ` +
      `Some rows may have been silently rejected.`
    );
  }
  return data;
}
