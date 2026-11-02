import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'
import { GATE_COOKIE, GATE_MAX_AGE, cookieOptions, gateToken, loadPortalPasswordHash, verifySecret } from '@/lib/hr/portal-session'
import { logHr } from '@/lib/hr/audit'

const ENDPOINT = 'hr-portal-unlock'

/** POST /api/hr-portal/unlock { password } — the shared HR link password. 10 wrong tries per IP per 15 min. */
export async function POST(request: NextRequest) {
  const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Enter the password' }, { status: 400 })

  const limit = await checkRateLimit(request, { endpoint: ENDPOINT, maxFailures: 10, windowSeconds: 900 })
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 })

  const db = await createServiceClient()
  const hash = await loadPortalPasswordHash(db)
  if (!hash) return Response.json({ error: 'The HR link has not been set up yet' }, { status: 503 })

  if (!verifySecret(parsed.data.password, hash)) {
    await recordAttempt(request, { endpoint: ENDPOINT, succeeded: false })
    await logHr(db, request, { type: 'visitor', label: 'Unknown visitor' }, 'link.unlock_failed')
    return Response.json({ error: 'Wrong password' }, { status: 401 })
  }

  await recordAttempt(request, { endpoint: ENDPOINT, succeeded: true })
  await logHr(db, request, { type: 'visitor', label: 'Visitor' }, 'link.unlock')
  const res = NextResponse.json({ ok: true })
  res.cookies.set(GATE_COOKIE, gateToken(hash), cookieOptions(GATE_MAX_AGE))
  return res
}
