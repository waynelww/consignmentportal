import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Actually disables login (bans the auth user) instead of the previous
// behaviour, which demoted the admin's profile role to store_owner —
// that left a dangling account that could plausibly gain a real store
// assignment later and pick up genuine store-owner access. Banning
// preserves the profile's role untouched, so if this is ever reversed
// (unban via the Supabase dashboard), the account's original admin
// permissions come back exactly as they were.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden: only super admins can deactivate users' }, { status: 403 })
  }

  if (userId === user.id) {
    return Response.json({ error: "You can't deactivate your own account" }, { status: 400 })
  }

  const svc = await createServiceClient()
  const { error } = await svc.auth.admin.updateUserById(userId, { ban_duration: '87600h' }) // ~10 years

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
