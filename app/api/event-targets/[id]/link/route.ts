import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess, recalcPosBonus } from '@/lib/events/target-api'

// POST { event_id } — link an old (unlinked) Event Target to an event.
// Name and start date follow the event from now on.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { id } = await params
  const parsed = z.object({ event_id: z.string().uuid() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Pick an event' }, { status: 400 })

  const svc = await createServiceClient()
  const [{ data: target }, { data: ev }, { data: taken }] = await Promise.all([
    svc.from('event_targets').select('id, event_id, audit_log').eq('id', id).maybeSingle(),
    svc.from('events').select('id, name, start_date').eq('id', parsed.data.event_id).maybeSingle(),
    svc.from('event_targets').select('id').eq('event_id', parsed.data.event_id).maybeSingle(),
  ])
  if (!target) return Response.json({ error: 'Target not found' }, { status: 404 })
  if (!ev) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (target.event_id) return Response.json({ error: 'This target is already linked' }, { status: 409 })
  if (taken) return Response.json({ error: 'That event already has a target' }, { status: 409 })

  const audit = [...((target.audit_log as unknown[]) ?? []), { action: 'link_event', event_id: ev.id, by: ctx.user.id, at: new Date().toISOString() }]
  const { error } = await svc.from('event_targets')
    .update({ event_id: ev.id, name: ev.name, start_date: ev.start_date, audit_log: audit, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return Response.json({ error: error.code === '23505' ? 'That event already has a target' : error.message }, { status: error.code === '23505' ? 409 : 500 })
  await recalcPosBonus(ev.id)
  return Response.json({ ok: true })
}
