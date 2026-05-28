import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Cookie-less service-role client for bot/cron/server-side jobs.
// Bypasses RLS — only use in trusted server contexts.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
