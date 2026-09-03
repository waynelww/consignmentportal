import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/gang/phone'
import { getActivePrizes } from '@/lib/gang/prizes'
import { getMemberStats } from '@/lib/gang/member-stats'
import { assignTickets } from '@/lib/gang/tickets'
import { grantFirstTimerCodes, countValidSubmissions } from '@/lib/gang/first-timer'

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
    .select('id, name, email, created_at, lifetime_code')
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

  const orderNumber = parsed.data.order_number.trim().replace(/^#/, '')

  const { data: duplicate, error: dupErr } = await supabase
    .from('gang_order_submissions')
    .select('id, member_id')
    .in('order_number', [orderNumber, `#${orderNumber}`])
    .limit(1)
    .maybeSingle()
  if (dupErr) {
    await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
    return Response.json({ error: 'Could not check your order number. Try again.' }, { status: 500 })
  }
  if (duplicate) {
    await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
    // Website orders auto-enroll on payment — so their own order is often
    // already in. Point them at their tickets instead of a dead end.
    const msg = duplicate.member_id === member.id
      ? "This order is already in! Tap '🎟️ Already registered? View my tickets' on the first step."
      : 'This order number has already been registered.'
    return Response.json({ error: msg }, { status: 409 })
  }

  // Website order numbers are sequential and guessable, so the typed order
  // must actually belong to this member: its checkout phone or email has
  // to match. Shopee/TikTok ids are long and random — no check needed.
  // A match against a PAID order is also full verification — Shopify just
  // confirmed the purchase, so don't make the customer wait for the 6PM
  // reconciliation to get their ticket.
  let shopifyVerified = false
  if (parsed.data.platform === 'website') {
    const { getOrderByName } = await import('@/lib/shopify/order-lookup')
    const order = await getOrderByName(orderNumber).catch(() => null)
    if (order) {
      const orderPhone = order.phone ? normalizePhone(order.phone) : null
      const phoneMatches = orderPhone !== null && orderPhone === phone
      const emailMatches =
        !!order.email && !!member.email && order.email.toLowerCase() === member.email.toLowerCase()
      if (!phoneMatches && !emailMatches) {
        await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
        return Response.json({
          error: "This order doesn't match your phone or email. Use the same details you checked out with, or WhatsApp us.",
        }, { status: 403 })
      }
      shopifyVerified = /paid/i.test(order.financialStatus ?? '')
    }
    // Order not found / Shopify down → fall through to 'pending'; the
    // daily reconciliation still guards it.
  }

  // A lookup error here just means the immediate-match convenience is
  // skipped (falls through to 'pending') — the daily bot reconciliation
  // catches it regardless, so this one is safe to soft-fail.
  const { data: validMatch } = await supabase
    .from('gang_valid_orders')
    .select('order_number')
    .in('order_number', [orderNumber, `#${orderNumber}`])
    .limit(1)
    .maybeSingle()

  const status = validMatch || shopifyVerified ? 'valid' : 'pending'

  const { data: submission, error: subErr } = await supabase
    .from('gang_order_submissions')
    .insert({
      member_id: member.id,
      order_number: orderNumber,
      platform: parsed.data.platform,
      status,
      verified_at: status === 'valid' ? new Date().toISOString() : null,
    })
    .select('id, order_number, platform, status, submitted_date, verified_at')
    .single()

  if (subErr) {
    await recordAttempt(request, { endpoint: 'gang-register', succeeded: false })
    return Response.json({ error: 'Could not save your order. Try again.' }, { status: 500 })
  }

  const prizes = await getActivePrizes(supabase).catch(() => [])

  // First-ever verified order → issue the two personal codes (one-time
  // free pair + lifetime 10%). A returning member's later orders never
  // re-trigger this — their reward is the extra lucky-draw ticket.
  // Pending orders are handled by the bot's daily verification instead.
  let firstTimer = null
  if (status === 'valid') {
    const validCount = await countValidSubmissions(supabase, member.id)
    if (validCount === 1) {
      firstTimer = await grantFirstTimerCodes(supabase, member.id)
    }
  }
  const stats = await getMemberStats(supabase, member.id).catch(() => null)

  // Instantly-verified orders get their lucky-draw ticket right away, so
  // the success screen can show the number on the spot.
  let ticket: { ticket_no: number; draw_month: string } | null = null
  if (status === 'valid') {
    const [assigned] = await assignTickets(supabase, [submission.id]).catch(() => [])
    if (assigned) ticket = { ticket_no: assigned.ticket_no, draw_month: assigned.draw_month }
  }

  await recordAttempt(request, { endpoint: 'gang-register', succeeded: true })

  return Response.json({ member, submission, prizes, stats, ticket, first_timer: firstTimer })
}
