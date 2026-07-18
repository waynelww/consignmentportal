import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single()

  if (eventErr || !event) return Response.json({ error: 'Event not found' }, { status: 404 })

  const { data: items, error: itemsErr } = await supabase
    .from('event_stock_items')
    .select('*, product:products(sku, name, image_url)')
    .eq('event_id', eventId)
    .order('created_at')

  if (itemsErr) return Response.json({ error: itemsErr.message }, { status: 500 })

  return Response.json({ event, items: items ?? [] })
}
