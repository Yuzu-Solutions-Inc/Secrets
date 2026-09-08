import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicSupabaseEnv, secretSupabaseKey } from "./env";

export function createAdminClient() {
  const env = publicSupabaseEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, secretSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
