import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess } from '@/lib/events/target-api'

// POST = lock (events lead or admin). DELETE = unlock (admin only, audited).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { id } = await params

  const svc = await createServiceClient()
  const { data: ev } = await svc.from('event_targets').select('id, locked_at, audit_log').eq('id', id).maybeSingle()
  if (!ev) return Response.json({ error: 'Not found' }, { status: 404 })
  if (ev.locked_at) return Response.json({ ok: true, locked_at: ev.locked_at })

  const now = new Date().toISOString()
  const audit = [...((ev.audit_log as unknown[]) ?? []), { action: 'lock', by: ctx.user.id, at: now }]
  const { error } = await svc.from('event_targets').update({ locked_at: now, audit_log: audit }).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, locked_at: now })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  if (ctx.role !== 'super_admin') {
    return Response.json({ error: 'Only an admin can unlock an event.' }, { status: 403 })
  }
  const { id } = await params

  const svc = await createServiceClient()
  const { data: ev } = await svc.from('event_targets').select('id, locked_at, audit_log').eq('id', id).maybeSingle()
  if (!ev) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!ev.locked_at) return Response.json({ ok: true })

  const audit = [...((ev.audit_log as unknown[]) ?? []), { action: 'unlock', by: ctx.user.id, at: new Date().toISOString() }]
  const { error } = await svc.from('event_targets').update({ locked_at: null, audit_log: audit }).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
