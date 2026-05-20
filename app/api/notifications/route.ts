import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  const { searchParams } = request.nextUrl
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  let query = supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (profile.role === 'store_owner') {
    // Store owners see notifications addressed to their store_id or null recipient_store_id
    query = query.or(`recipient_store_id.eq.${profile.store_id},and(recipient_store_id.is.null,recipient_role.is.null)`)
  } else {
    // Admins see notifications for their role or broadcast
    query = query.or(`recipient_role.eq.${profile.role},recipient_role.is.null`)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ notifications: data })
}

const BulkReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  is_read: z.literal(true),
})

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BulkReadSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { ids } = parsed.data

  // Build filter so users can only mark their own notifications
  let query = supabase
    .from('notifications')
    .update({ is_read: true })
    .in('id', ids)

  if (profile.role === 'store_owner') {
    query = query.eq('recipient_store_id', profile.store_id)
  } else {
    query = query.eq('recipient_role', profile.role)
  }

  const { error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
