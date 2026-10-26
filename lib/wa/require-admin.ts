import { createClient } from '@/lib/supabase/server'

// Shared guard for the /api/admin/wa/* routes: signed-in super_admin or
// ops_manager. Returns null when allowed, or a ready-to-return Response.
export async function requireWaAdmin(): Promise<{ denied: Response | null; userId: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { denied: Response.json({ error: 'Unauthorized' }, { status: 401 }), userId: null }
  }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return { denied: Response.json({ error: 'Forbidden' }, { status: 403 }), userId: null }
  }
  return { denied: null, userId: user.id }
}
