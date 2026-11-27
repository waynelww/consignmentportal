import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import {
  POS_PIN_PATTERN, getPosPinHash, loadPosEvent, pinLockedSeconds, posCookieName, posCookieOptions, posToken, recordPinAttempt, verifySecret,
} from '@/lib/pos/session'

// POST { staff_id, pin } — 5 wrong PINs lock that person for 5 minutes.
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const parsed = z.object({ staff_id: z.string().uuid(), pin: z.string().regex(POS_PIN_PATTERN, 'PIN is 4 digits') })
    .safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const { staff_id, pin } = parsed.data

  const db = await createServiceClient()
  const event = await loadPosEvent(db, eventId)
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (event.status !== 'active') return Response.json({ error: 'This event is closed', closed: true }, { status: 409 })

  const { data: link } = await db.from('event_staff').select('hidden, pos_staff(id, name)')
    .eq('event_id', eventId).eq('staff_id', staff_id).maybeSingle()
  const person = (link as unknown as { hidden: boolean; pos_staff: { id: string; name: string } | null } | null)
  if (!person || person.hidden || !person.pos_staff) return Response.json({ error: 'Name not found' }, { status: 404 })

  const locked = await pinLockedSeconds(db, staff_id)
  if (locked > 0) {
    return Response.json({ error: `Too many wrong PINs. Try again in ${Math.ceil(locked / 60)} min.`, locked_seconds: locked }, { status: 429 })
  }

  const pinHash = await getPosPinHash(db, staff_id)
  if (!pinHash || !verifySecret(pin, pinHash)) {
    await recordPinAttempt(db, request, staff_id, false)
    const nowLocked = await pinLockedSeconds(db, staff_id)
    return Response.json(
      nowLocked > 0
        ? { error: 'Too many wrong PINs. Locked for 5 minutes.', locked_seconds: nowLocked }
        : { error: pinHash ? 'Wrong PIN' : 'No PIN set — ask the admin' },
      { status: nowLocked > 0 ? 429 : 401 },
    )
  }
  await recordPinAttempt(db, request, staff_id, true)

  const res = NextResponse.json({ me: person.pos_staff })
  res.cookies.set(posCookieName(eventId), posToken(eventId, staff_id, pinHash), posCookieOptions())
  return res
}
