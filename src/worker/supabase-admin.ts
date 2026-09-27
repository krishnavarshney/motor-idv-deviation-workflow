/**
 * Service-role Supabase client for the worker.
 * Uses the service role key which BYPASSES all RLS policies.
 * This must NEVER be exposed to the browser or the Next.js client runtime.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getAdminClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  if (!_client) {
    _client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _client;
}

/**
 * Reset the cached client — useful in tests.
 */
export function resetAdminClient(): void {
  _client = null;
}
