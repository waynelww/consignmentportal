import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess } from '@/lib/events/target-api'
import { POS_PIN_PATTERN, generatePin, setPosPin } from '@/lib/pos/session'

// POST { pin? } — reset a part-timer's PIN (blank = generate). Signs them out
// of every phone. The PIN is returned once so the admin can WhatsApp it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string; staffId: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { eventId, staffId } = await params
  const parsed = z.object({ pin: z.union([z.literal(''), z.string().regex(POS_PIN_PATTERN, 'PIN must be 4 digits')]).nullish() })
    .safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid' }, { status: 400 })
  const db = await createServiceClient()
  const { data: link } = await db.from('event_staff').select('staff_id').eq('event_id', eventId).eq('staff_id', staffId).maybeSingle()
  if (!link) return Response.json({ error: 'Not on this event' }, { status: 404 })
  const pin = parsed.data.pin || generatePin()
  try { await setPosPin(db, staffId, pin) } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
  return Response.json({ ok: true, pin })
}
