import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _serviceClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client using service role key (singleton).
 * Only use in API routes (server-side), never expose to client.
 */
export function getServiceClient(): SupabaseClient {
  if (!_serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? (process.env.POSTGRES_HOST ? `https://${process.env.POSTGRES_HOST.replace('db.', '')}` : '');
    const key = process.env.SUPABASE_SERVICE_KEY
      ?? process.env.SUPABASE_SECRET_KEY
      ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    _serviceClient = createClient(url, key);
  }
  return _serviceClient;
}
