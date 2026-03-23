import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using service role key.
 * Only use in API routes (server-side), never expose to client.
 */
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}
