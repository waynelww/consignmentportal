import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** The onboarding board is for admins only (super_admin, ops_manager). */
export async function authoriseOnboarding(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
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

/**
 * Every write records who did it. The admin login is shared, so the person is
 * a Xocks team member picked in the app. Returns false for hidden or unknown names.
 */
export async function isActiveTeamMember(memberId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('xocks_team_members')
    .select('id')
    .eq('id', memberId)
    .eq('active', true)
    .maybeSingle()
  return !!data
}
