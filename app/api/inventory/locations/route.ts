import { createClient } from '@/lib/supabase/server'

// Every place stock can sit: Office + the fixed retail/printing
// locations + any currently-active event. Used to populate the
// From/To pickers on the Transfer Stock flow.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('stock_locations')
    .select('id, name, type, event_id, events:event_id(status)')
    .eq('is_active', true)
    .order('type')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Only surface event locations while their event is still active —
  // a closed event shouldn't appear as a transfer destination.
  const locations = (data ?? [])
    .filter((l) => l.type !== 'event' || (l.events as unknown as { status: string } | null)?.status === 'active')
    .map((l) => ({ id: l.id, name: l.name, type: l.type }))

  return Response.json({ locations })
}
