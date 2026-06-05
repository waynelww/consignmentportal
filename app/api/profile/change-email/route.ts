import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const Schema = z.object({
  new_email: z.string().email(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation', details: parsed.error.flatten() }, { status: 400 })
  }

  const { new_email } = parsed.data

  if (new_email.toLowerCase() === user.email?.toLowerCase()) {
    return Response.json({ error: 'New email is the same as current' }, { status: 400 })
  }

  // Supabase sends a confirmation email to the new address. The change
  // only takes effect once the user clicks the link in that email.
  const { error } = await supabase.auth.updateUser({
    email: new_email,
  })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({
    success: true,
    message: `Confirmation email sent to ${new_email}. Click the link in that email to complete the change.`,
  })
}
