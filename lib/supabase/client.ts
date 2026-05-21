import { createBrowserClient } from '@supabase/ssr'

// Singleton — reuse the same client across all components.
// Safe in the browser because there is only one user session per tab.
let _client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _client
}
