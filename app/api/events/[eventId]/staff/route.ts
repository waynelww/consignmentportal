import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess } from '@/lib/events/target-api'
import { POS_PIN_PATTERN, generatePin, setPosPin } from '@/lib/pos/session'

// GET — part-timers on this event, with sale counts and whether a PIN is set
// (never the PIN or its hash).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { eventId } = await params
  const db = await createServiceClient()
  const [{ data: rows, error }, { data: sales }] = await Promise.all([
    db.from('event_staff').select('staff_id, hidden, added_at, pos_staff(id, name, phone)').eq('event_id', eventId).order('added_at'),
    db.from('pos_sales').select('staff_id').eq('event_id', eventId),
  ])
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const ids = (rows ?? []).map((r) => r.staff_id)
  const { data: pins } = ids.length ? await db.from('pos_staff_pins').select('staff_id').in('staff_id', ids) : { data: [] }
  const withPin = new Set((pins ?? []).map((p) => p.staff_id))
  const saleCount = new Map<string, number>()
  for (const s of sales ?? []) saleCount.set(s.staff_id, (saleCount.get(s.staff_id) ?? 0) + 1)
  return Response.json({
    staff: (rows ?? []).map((r) => {
      const p = r.pos_staff as unknown as { id: string; name: string; phone: string | null }
      return { id: p.id, name: p.name, phone: p.phone, hidden: r.hidden, added_at: r.added_at, has_pin: withPin.has(p.id), sales: saleCount.get(p.id) ?? 0 }
    }),
  })
}

const AddSchema = z.union([
  z.object({ staff_id: z.string().uuid() }),
  z.object({
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().max(30).nullish(),
    pin: z.union([z.literal(''), z.string().regex(POS_PIN_PATTERN, 'PIN must be 4 digits')]).nullish(),
  }),
])

// POST — add a past part-timer ({staff_id}, keeps their PIN) or a new one
// ({name, phone?, pin?}). A blank PIN is generated and returned ONCE.
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { eventId } = await params
  const parsed = AddSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid' }, { status: 400 })
  const db = await createServiceClient()

  const { data: ev } = await db.from('events').select('id').eq('id', eventId).maybeSingle()
  if (!ev) return Response.json({ error: 'Event not found' }, { status: 404 })

  let staffId: string
  let newPin: string | null = null
  if ('staff_id' in parsed.data) {
    staffId = parsed.data.staff_id
    const { data: p } = await db.from('pos_staff').select('id').eq('id', staffId).maybeSingle()
    if (!p) return Response.json({ error: 'Person not found' }, { status: 404 })
  } else {
    const { data: p, error } = await db.from('pos_staff')
      .insert({ name: parsed.data.name, phone: parsed.data.phone || null }).select('id').single()
    if (error || !p) return Response.json({ error: error?.message ?? 'Could not add' }, { status: 500 })
    staffId = p.id
    const pin = parsed.data.pin || generatePin()
    await setPosPin(db, staffId, pin)
    newPin = parsed.data.pin ? null : pin
  }

  const { error: linkErr } = await db.from('event_staff').upsert({ event_id: eventId, staff_id: staffId, hidden: false }, { onConflict: 'event_id,staff_id' })
  if (linkErr) return Response.json({ error: linkErr.message }, { status: 500 })
  return Response.json({ ok: true, staff_id: staffId, generated_pin: newPin })
}
