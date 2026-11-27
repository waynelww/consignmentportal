import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess } from '@/lib/events/target-api'

// GET ?q=name&event_id= — part-timers from past events, for one-tap re-adding.
export async function GET(request: NextRequest) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  const eventId = request.nextUrl.searchParams.get('event_id')
  if (q.length < 1) return Response.json({ people: [] })
  const db = await createServiceClient()
  const { data, error } = await db.from('pos_staff')
    .select('id, name, phone, event_staff(event_id, events(name))')
    .ilike('name', `%${q.replace(/[%_,()]/g, '')}%`)
    .order('name').limit(8)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const people = (data ?? [])
    .map((p) => {
      const links = (p.event_staff ?? []) as unknown as { event_id: string; events: { name: string } | null }[]
      return {
        id: p.id, name: p.name, phone: p.phone,
        on_this_event: links.some((l) => l.event_id === eventId),
        past_events: links.filter((l) => l.event_id !== eventId).map((l) => l.events?.name).filter(Boolean).slice(0, 3),
      }
    })
    .filter((p) => !p.on_this_event)
  return Response.json({ people })
}
