import { type NextRequest } from 'next/server'
import { z } from 'zod'
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

const CreateLocationSchema = z.object({
  name: z.string().trim().min(1).max(100),
})

// Lets an admin add a new fixed destination (e.g. a new retail spot)
// on the fly from the Transfer Stock modal, instead of asking for a
// code change every time. Persists — shows up in every future GET.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const parsed = CreateLocationSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('stock_locations')
    .select('id, name, type')
    .ilike('name', parsed.data.name)
    .eq('is_active', true)
    .maybeSingle()

  if (existing) return Response.json({ location: existing }) // already exists — just reuse it

  const { data: location, error } = await supabase
    .from('stock_locations')
    .insert({ name: parsed.data.name, type: 'retail' })
    .select('id, name, type')
    .single()

  if (error || !location) return Response.json({ error: error?.message ?? 'Failed to create location' }, { status: 500 })

  return Response.json({ location })
}
