import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const CreateEventSchema = z.object({
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional().nullable(),
  shopify_location_id: z.string().trim().optional().nullable(),
  shopify_location_name: z.string().trim().optional().nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { supabase, user }
}

export async function GET() {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { supabase } = ctx

  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .order('start_date', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const locationIds = (events ?? []).map((e) => e.stock_location_id).filter(Boolean) as string[]

  // Aggregate "taken" per event from the ledger — inbound transfers into
  // that event's location — instead of a separately-maintained counter.
  let takenByLocation: Record<string, { skus: Set<string>; totalTaken: number }> = {}
  if (locationIds.length > 0) {
    const { data: transfers } = await supabase
      .from('stock_transfers')
      .select('to_location_id, product_id, quantity')
      .in('to_location_id', locationIds)

    takenByLocation = {}
    for (const t of transfers ?? []) {
      const key = t.to_location_id as string
      if (!takenByLocation[key]) takenByLocation[key] = { skus: new Set(), totalTaken: 0 }
      takenByLocation[key].skus.add(t.product_id)
      takenByLocation[key].totalTaken += t.quantity
    }
  }

  const result = (events ?? []).map((e) => {
    const agg = e.stock_location_id ? takenByLocation[e.stock_location_id] : undefined
    return {
      ...e,
      sku_count: agg?.skus.size ?? 0,
      total_taken: agg?.totalTaken ?? 0,
    }
  })

  return Response.json({ events: result })
}

export async function POST(request: NextRequest) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { user } = ctx

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const parsed = CreateEventSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = await createServiceClient()

  // Event and its stock location reference each other — create in three
  // steps, cleaning up if a later step fails.
  const { data: event, error: eventErr } = await svc
    .from('events')
    .insert({ ...parsed.data, created_by: user!.id })
    .select('id, name')
    .single()

  if (eventErr || !event) return Response.json({ error: eventErr?.message ?? 'Failed to create event' }, { status: 500 })

  const { data: location, error: locErr } = await svc
    .from('stock_locations')
    .insert({ name: event.name, type: 'event', event_id: event.id })
    .select('id')
    .single()

  if (locErr || !location) {
    await svc.from('events').delete().eq('id', event.id)
    return Response.json({ error: locErr?.message ?? 'Failed to create event location' }, { status: 500 })
  }

  const { error: linkErr } = await svc.from('events').update({ stock_location_id: location.id }).eq('id', event.id)
  if (linkErr) {
    await svc.from('stock_locations').delete().eq('id', location.id)
    await svc.from('events').delete().eq('id', event.id)
    return Response.json({ error: linkErr.message }, { status: 500 })
  }

  return Response.json({ success: true, id: event.id })
}
