import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const CreateUserSchema = z.object({
  email: z.string().trim().email(),
  full_name: z.string().trim().min(1).max(200),
  role: z.enum(['super_admin', 'ops_manager']),
})

// Creates a new admin account and emails them a Supabase-hosted invite
// link to set their own password — nobody, including the admin who
// creates the account, ever sees or sets the new user's password.
// Creating another admin is a high-privilege action, so it's restricted
// to super_admin (not ops_manager, unlike most other admin routes).
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden: only super admins can add admin users' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const parsed = CreateUserSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }
  const { email, full_name, role } = parsed.data

  const svc = await createServiceClient()

  const { data: invited, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email)
  if (inviteErr || !invited.user) {
    return Response.json({ error: inviteErr?.message ?? 'Failed to invite user' }, { status: 500 })
  }

  const { error: profileErr } = await svc.from('profiles').insert({
    id: invited.user.id,
    full_name,
    phone: null,
    role,
    store_id: null,
  })

  if (profileErr) {
    // Roll back the auth user so a failed invite doesn't leave an orphan
    await svc.auth.admin.deleteUser(invited.user.id)
    return Response.json({ error: 'Failed to create profile', details: profileErr.message }, { status: 500 })
  }

  return Response.json({ success: true, user_id: invited.user.id })
}
