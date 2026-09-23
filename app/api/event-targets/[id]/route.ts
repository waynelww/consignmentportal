import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess, EventTargetSchema, saveEventTarget } from '@/lib/events/target-api'

// PATCH — edit inputs and recalculate. Blocked once locked: announced
// numbers must never change mid-event (admin unlocks first if truly needed).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { id } = await params

  const svc = await createServiceClient()
  const { data: existing } = await svc.from('event_targets').select('id, locked_at').eq('id', id).maybeSingle()
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (existing.locked_at) {
    return Response.json({ error: 'This event is locked — targets are frozen. Ask an admin to unlock it first.' }, { status: 409 })
  }

  const parsed = EventTargetSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const saved = await saveEventTarget(parsed.data, { id })
  if ('error' in saved) return Response.json({ error: saved.error }, { status: 500 })
  return Response.json({ id, calc: saved.result })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { id } = await params

  const svc = await createServiceClient()
  const { data: existing } = await svc.from('event_targets').select('id, locked_at').eq('id', id).maybeSingle()
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (existing.locked_at && ctx.role !== 'super_admin') {
    return Response.json({ error: 'Locked events can only be deleted by an admin.' }, { status: 403 })
  }

  const { error } = await svc.from('event_targets').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
