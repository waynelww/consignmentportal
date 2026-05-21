/**
 * POST /api/push/subscribe
 * Saves a Web Push subscription for the authenticated store owner.
 * Called by the client after the user grants notification permission.
 */
import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile?.store_id) {
    return Response.json({ error: 'No store linked to this account' }, { status: 403 })
  }

  let body: { endpoint: string; keys: { p256dh: string; auth: string } }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { endpoint, keys } = body
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return Response.json({ error: 'Missing subscription fields' }, { status: 400 })
  }

  // Upsert — same endpoint replaces itself
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        store_id: profile.store_id,
        user_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: 'endpoint' }
    )

  if (error) {
    console.error('[push/subscribe]', error.message)
    return Response.json({ error: 'Failed to save subscription' }, { status: 500 })
  }

  return Response.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { endpoint: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  await supabase.from('push_subscriptions').delete().eq('endpoint', body.endpoint).eq('user_id', user.id)
  return Response.json({ success: true })
}
