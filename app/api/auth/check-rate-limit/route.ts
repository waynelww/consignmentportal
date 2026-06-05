import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'

const Schema = z.object({
  endpoint: z.enum(['login', 'forgot-password']),
  email: z.string().email().optional().nullable(),
  // Set true after a SUCCESSFUL operation so the success is recorded
  // (doesn't count toward limit, but allows analytics)
  succeeded: z.boolean().optional(),
})

// Limits — easy to tune later
const LIMITS: Record<string, { maxFailures: number; windowSeconds: number }> = {
  login: { maxFailures: 5, windowSeconds: 15 * 60 },           // 5 failures / 15 min
  'forgot-password': { maxFailures: 3, windowSeconds: 60 * 60 }, // 3 emails / hour
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation' }, { status: 400 })
  }

  const limits = LIMITS[parsed.data.endpoint]

  // If the client is reporting an outcome, record it
  if (parsed.data.succeeded !== undefined) {
    await recordAttempt(request, {
      endpoint: parsed.data.endpoint,
      email: parsed.data.email,
      succeeded: parsed.data.succeeded,
    })
    return Response.json({ ok: true, recorded: true })
  }

  // Otherwise this is a check before attempting
  const result = await checkRateLimit(request, {
    endpoint: parsed.data.endpoint,
    email: parsed.data.email,
    maxFailures: limits.maxFailures,
    windowSeconds: limits.windowSeconds,
  })

  if (!result.ok) {
    return Response.json(
      { error: result.reason ?? 'Rate limited', remaining: 0 },
      { status: 429 },
    )
  }

  return Response.json({ ok: true, remaining: result.remaining })
}
