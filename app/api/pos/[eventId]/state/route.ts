import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { loadPosEvent, posSession } from '@/lib/pos/session'

// GET — public. Event name/status and the "Who's selling?" tiles. Never
// returns PINs, phones, sales or anything about event profit.
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const db = await createServiceClient()
  const event = await loadPosEvent(db, eventId)
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (event.status !== 'active') return Response.json({ closed: true, event: { name: event.name } })

  const [{ data: staff }, session] = await Promise.all([
    db.from('event_staff').select('added_at, pos_staff(id, name)').eq('event_id', eventId).eq('hidden', false).order('added_at'),
    posSession(request, db, eventId),
  ])
  const people = ((staff ?? []) as unknown as { pos_staff: { id: string; name: string } | null }[])
    .filter((r) => r.pos_staff).map((r) => ({ id: r.pos_staff!.id, name: r.pos_staff!.name }))
  return Response.json({
    closed: false,
    event: { id: event.id, name: event.name, start_date: event.start_date, end_date: event.end_date },
    staff: people,
    me: session?.staff ?? null,
  })
}
