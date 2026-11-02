import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'
import {
  MEMBER_COOKIE, MEMBER_MAX_AGE, PIN_PATTERN, cookieOptions, hasGate, hashSecret, memberToken, verifySecret,
} from '@/lib/hr/portal-session'
import { logHr } from '@/lib/hr/audit'

const ENDPOINT = 'hr-portal-pin'

/**
 * POST /api/hr-portal/login { member_id, pin }
 * If the person has no PIN yet (new, or reset by the admin), this PIN becomes
 * theirs. Otherwise it must match. 5 wrong PINs per person per 15 minutes.
 */
export async function POST(request: NextRequest) {
  const db = await createServiceClient()
  if (!(await hasGate(request, db))) return Response.json({ error: 'Locked' }, { status: 401 })

  const parsed = z.object({
    member_id: z.string().uuid(),
    pin: z.string().regex(PIN_PATTERN, 'PIN must be 4 to 6 digits'),
  }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  const { member_id, pin } = parsed.data

  const { data: m } = await db.from('xocks_team_members').select('id, name, active, hr_pin_hash').eq('id', member_id).maybeSingle()
  if (!m?.active) return Response.json({ error: 'Name not found' }, { status: 404 })
  const actor = { type: 'staff' as const, memberId: m.id, label: m.name }

  let pinHash = m.hr_pin_hash as string | null
  if (!pinHash) {
    pinHash = hashSecret(pin)
    // Only claim the PIN if it is still unset (two phones racing → one wins).
    const { data: set } = await db.from('xocks_team_members').update({ hr_pin_hash: pinHash })
      .eq('id', m.id).is('hr_pin_hash', null).select('id')
    if (!set?.length) return Response.json({ error: 'A PIN was just set for this name. Enter that PIN.' }, { status: 409 })
    await logHr(db, request, actor, 'pin.created', { type: 'member', id: m.id })
  } else {
    // Keyed by person (in the email column) so guessing is capped across devices too.
    const key = `hr-member:${m.id}`
    const limit = await checkRateLimit(request, { endpoint: ENDPOINT, maxFailures: 5, windowSeconds: 900, email: key })
    if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 })
    if (!verifySecret(pin, pinHash)) {
      await recordAttempt(request, { endpoint: ENDPOINT, email: key, succeeded: false })
      await logHr(db, request, actor, 'pin.failed', { type: 'member', id: m.id })
      return Response.json({ error: 'Wrong PIN' }, { status: 401 })
    }
    await recordAttempt(request, { endpoint: ENDPOINT, email: key, succeeded: true })
    await logHr(db, request, actor, 'pin.login', { type: 'member', id: m.id })
  }

  const res = NextResponse.json({ member: { id: m.id, name: m.name } })
  res.cookies.set(MEMBER_COOKIE, memberToken(m.id, pinHash), cookieOptions(MEMBER_MAX_AGE))
  return res
}
