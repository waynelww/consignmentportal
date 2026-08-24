import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/gang/phone'
import { getActivePrizes } from '@/lib/gang/prizes'
import { grantShopifyPerk } from '@/lib/gang/grant-perk'
import { getMemberStats } from '@/lib/gang/member-stats'

const Schema = z.object({
  phone: z.string().min(6),
  platform: z.enum(['shopee', 'tiktok', 'website']),
  order_number: z.string().min(3),
})

// POST /api/gang/register
// Public. Records an order submission for an existing member (the profile
// itself is created earlier via /api/gang/save-step, during the phone+name
// and email steps — by the time this runs the member should already exist).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) {
    return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 })
  }

  const limit = await checkRateLimit(request, {
    endpoint: 'gang-register',
    maxFailures: 10,
    windowSeconds: 3600,
  })
  if (!limit.ok) {
    return Response.json({ error: limit.reason }, { status: 429 })
  }

  const supabase = createAdminClient()

  const { data: member, error: lookupErr } = await supabase
    .from('gang_members')
    .select('id, name, email, created_at')
    .eq('phone', phone)
    .maybeSingle()
  if (lookupErr) {
    await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
    return Response.json({ error: 'Could not look up your membership. Try again.' }, { status: 500 })
  }
  if (!member) {
    await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
    return Response.json({ error: 'Please complete your details first.' }, { status: 400 })
  }

  const orderNumber = parsed.data.order_number.trim()

  const { data: duplicate, error: dupErr } = await supabase
    .from('gang_order_submissions')
    .select('id')
    .eq('order_number', orderNumber)
    .maybeSingle()
  if (dupErr) {
    await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
    return Response.json({ error: 'Could not check your order number. Try again.' }, { status: 500 })
  }
  if (duplicate) {
    await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
    return Response.json({ error: 'This order number has already been registered.' }, { status: 409 })
  }

  // A lookup error here just means the immediate-match convenience is
  // skipped (falls through to 'pending') — the daily bot reconciliation
  // catches it regardless, so this one is safe to soft-fail.
  const { data: validMatch } = await supabase
    .from('gang_valid_orders')
    .select('order_number')
    .eq('order_number', orderNumber)
    .maybeSingle()

  const status = validMatch ? 'valid' : 'pending'

  const { data: submission, error: subErr } = await supabase
    .from('gang_order_submissions')
    .insert({
      member_id: member.id,
      order_number: orderNumber,
      platform: parsed.data.platform,
      status,
      verified_at: validMatch ? new Date().toISOString() : null,
    })
    .select('id, order_number, platform, status, submitted_date, verified_at')
    .single()

  if (subErr) {
    await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
    return Response.json({ error: 'Could not save your order. Try again.' }, { status: 500 })
  }

  const prizes = await getActivePrizes(supabase).catch(() => [])

  // Only the immediate-match path grants the perk here — an order that's
  // still 'pending' gets it later, when the bot's daily upload verifies it.
  const perk = status === 'valid' ? await grantShopifyPerk(supabase, member.id) : null
  const stats = await getMemberStats(supabase, member.id).catch(() => null)

  await recordAttempt(request, { endpoint: 'gang-register', succeeded: true })

  return Response.json({ member, submission, prizes, perk, stats })
}
