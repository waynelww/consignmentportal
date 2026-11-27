import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess } from '@/lib/events/target-api'

type P = { params: Promise<{ eventId: string; staffId: string }> }

// PATCH { hidden } — hide from / show on the POS. Sales are kept.
export async function PATCH(request: NextRequest, { params }: P) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { eventId, staffId } = await params
  const parsed = z.object({ hidden: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid' }, { status: 400 })
  const db = await createServiceClient()
  const { error } = await db.from('event_staff').update({ hidden: parsed.data.hidden }).eq('event_id', eventId).eq('staff_id', staffId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

// DELETE — remove from this event, only if they have no sales on it (voided included).
export async function DELETE(_request: NextRequest, { params }: P) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { eventId, staffId } = await params
  const db = await createServiceClient()
  const { count } = await db.from('pos_sales').select('id', { count: 'exact', head: true }).eq('event_id', eventId).eq('staff_id', staffId)
  if ((count ?? 0) > 0) return Response.json({ error: 'They have sales on this event — use "Hide from POS" instead' }, { status: 409 })
  const { error } = await db.from('event_staff').delete().eq('event_id', eventId).eq('staff_id', staffId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
