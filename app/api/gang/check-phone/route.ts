import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/gang/phone'
import { getMemberStats } from '@/lib/gang/member-stats'

const Schema = z.object({ phone: z.string().min(6) })

// POST /api/gang/check-phone
// Public. Lets the registration page skip the name/email step for a phone
// that's already a Gang member.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 })
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) {
    return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 })
  }

  // This is a low-stakes lookup, not an auth action — every call counts
  // against the limit (recorded as succeeded=false) rather than only
  // failures, so it actually caps total lookups per IP per window.
  const limit = await checkRateLimit(request, {
    endpoint: 'gang-check-phone',
    maxFailures: 30,
    windowSeconds: 3600,
  })
  if (!limit.ok) {
    return Response.json({ error: limit.reason }, { status: 429 })
  }
  await recordAttempt(request, { endpoint: 'gang-check-phone', succeeded: false })

  const supabase = createAdminClient()
  const { data: member, error } = await supabase
    .from('gang_members')
    .select('id, name')
    .eq('phone', phone)
    .maybeSingle()
  if (error) {
    return Response.json({ error: 'Could not look up that number. Try again.' }, { status: 500 })
  }

  const stats = member ? await getMemberStats(supabase, member.id) : null

  return Response.json({ exists: !!member, name: member?.name ?? null, stats })
}
