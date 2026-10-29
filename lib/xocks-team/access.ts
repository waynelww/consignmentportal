import { createClient } from '@/lib/supabase/server'

/**
 * The Xocks team list is managed by admins only (super_admin, ops_manager).
 * Store owners never see it.
 */
export async function authoriseXocksTeam(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role === 'super_admin' || profile?.role === 'ops_manager') return { ok: true }
  return { ok: false, status: 403, error: 'Forbidden: admin only' }
}

export const TEAM_NAME_DUPLICATE = 'That name is already on the Xocks team list'
