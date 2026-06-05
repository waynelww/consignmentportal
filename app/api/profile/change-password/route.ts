import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const Schema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation', details: parsed.error.flatten() }, { status: 400 })
  }

  // Verify the current password by attempting a sign-in with it
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.current_password,
  })

  if (verifyErr) {
    return Response.json({ error: 'Current password is incorrect' }, { status: 401 })
  }

  // Update to the new password
  const { error: updateErr } = await supabase.auth.updateUser({
    password: parsed.data.new_password,
  })

  if (updateErr) {
    return Response.json({ error: updateErr.message }, { status: 500 })
  }

  // Security hardening: invalidate every OTHER active session for this user
  // so that if the old password was compromised, the attacker is kicked out.
  // The current session (the one making this request) is preserved.
  try {
    await supabase.auth.signOut({ scope: 'others' })
  } catch (err) {
    // Non-fatal — log but don't fail the password change
    console.warn('[change-password] signOut(others) failed:', err)
  }

  return Response.json({
    success: true,
    message: 'Password updated. All other devices have been signed out.',
  })
}
