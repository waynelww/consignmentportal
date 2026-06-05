import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RateLimitOptions {
  endpoint: string
  // Max FAILED attempts in the window before blocking. Successful attempts
  // don't count toward the limit (so legitimate users aren't punished for
  // logging in 10 times in a day).
  maxFailures: number
  windowSeconds: number
  email?: string | null
}

interface RateLimitResult {
  ok: boolean
  remaining: number
  resetSeconds: number
  reason?: string
}

export function getClientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for. Pick the first (leftmost = original client).
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

/**
 * Check whether the caller is within rate limit. Returns ok=true if allowed,
 * ok=false with a reason and reset time if blocked.
 *
 * Call BEFORE attempting the operation. After, call recordAttempt() with
 * the outcome so future requests have an accurate failure count.
 */
export async function checkRateLimit(
  req: NextRequest,
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const ip = getClientIp(req)
  const since = new Date(Date.now() - opts.windowSeconds * 1000).toISOString()

  const admin = createAdminClient()

  // Count failed attempts from this IP at this endpoint in the window
  let query = admin
    .from('rate_limit_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('endpoint', opts.endpoint)
    .eq('succeeded', false)
    .gte('created_at', since)

  const { count: ipFails } = await query

  // Also check by email (for distributed brute-force across many IPs)
  let emailFails = 0
  if (opts.email) {
    const { count } = await admin
      .from('rate_limit_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('email', opts.email)
      .eq('endpoint', opts.endpoint)
      .eq('succeeded', false)
      .gte('created_at', since)
    emailFails = count ?? 0
  }

  const total = Math.max(ipFails ?? 0, emailFails)
  if (total >= opts.maxFailures) {
    return {
      ok: false,
      remaining: 0,
      resetSeconds: opts.windowSeconds,
      reason: `Too many attempts. Try again in ${Math.ceil(opts.windowSeconds / 60)} minutes.`,
    }
  }

  return {
    ok: true,
    remaining: opts.maxFailures - total,
    resetSeconds: opts.windowSeconds,
  }
}

/**
 * Record an attempt for rate-limit tracking. Pass succeeded=true for valid
 * logins (which don't count against the limit) and false for failures.
 */
export async function recordAttempt(
  req: NextRequest,
  opts: { endpoint: string; email?: string | null; succeeded: boolean }
): Promise<void> {
  const ip = getClientIp(req)
  const admin = createAdminClient()
  try {
    await admin.from('rate_limit_attempts').insert({
      ip,
      endpoint: opts.endpoint,
      email: opts.email ?? null,
      succeeded: opts.succeeded,
    })
  } catch (err) {
    // Non-fatal — better to allow the attempt than block on an audit table failure
    console.warn('[rate-limit] recordAttempt failed:', err)
  }
}

/**
 * Helper: prune anything older than 24h. Call from a cron occasionally so the
 * table doesn't grow forever. Not needed for correctness — old rows just
 * never match the windowed query.
 */
export async function pruneOldAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const admin = createAdminClient()
  const { count } = await admin
    .from('rate_limit_attempts')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  return count ?? 0
}
