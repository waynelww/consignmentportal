import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/gang/phone'
import { getOrderById } from '@/lib/shopify/order-lookup'
import { assignTickets } from '@/lib/gang/tickets'
import { grantFirstTimerCodes, countValidSubmissions } from '@/lib/gang/first-timer'

// POST /api/gang/shopify-webhook?key=CRON_SECRET
// Shopify ORDERS_PAID webhook: auto-enrolls website buyers into the Gang.
// They already gave us name/phone/email at checkout, so there's nothing to
// type — member created/matched, order recorded as verified (it came from
// Shopify itself), lucky-draw ticket issued, first-timer codes granted.
//
// Security model: the payload is used ONLY as a trigger carrying an order
// id — every fact we act on is re-fetched from the Shopify Admin API, so a
// forged request can't inject data. The key param keeps drive-by noise out.
export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get('key') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await request.json().catch(() => null) as { id?: number | string } | null
  if (!payload?.id) {
    // Always 200 on junk — a non-2xx makes Shopify retry for days.
    return Response.json({ ok: true, skipped: 'no order id' })
  }

  const order = await getOrderById(payload.id).catch(() => null)
  if (!order) return Response.json({ ok: true, skipped: 'order not found on Shopify' })

  // Online-store orders only. POS sales (Central Market / IOI walk-ins)
  // and manually created / draft orders (wholesale, OEM invoices) must
  // NOT auto-enroll — a wholesale buyer getting a personal lifetime 10%
  // code would be a genuine leak. Those customers can still join via the
  // QR card like everyone else.
  if (order.sourceName !== 'web') {
    return Response.json({ ok: true, skipped: `source ${order.sourceName ?? 'unknown'} not auto-enrolled` })
  }

  const phone = order.phone ? normalizePhone(order.phone) : null
  if (!phone) {
    // No phone at checkout — nothing to key the membership on. The customer
    // can still join manually via the QR card.
    return Response.json({ ok: true, skipped: 'order has no phone' })
  }

  const supabase = createAdminClient()
  const orderNumber = order.orderName.replace(/^#/, '')

  // Already registered (either variant, by webhook retry or manually)?
  const { data: existing } = await supabase
    .from('gang_order_submissions')
    .select('id')
    .in('order_number', [orderNumber, `#${orderNumber}`])
    .limit(1)
    .maybeSingle()
  if (existing) return Response.json({ ok: true, skipped: 'already registered' })

  // Find or create the member by phone.
  let memberId: string
  const { data: member } = await supabase
    .from('gang_members')
    .select('id')
    .eq('phone', phone)
    .maybeSingle()

  if (member) {
    memberId = member.id
  } else {
    const { data: created, error: createErr } = await supabase
      .from('gang_members')
      .insert({
        phone,
        name: order.customerName || 'Gang member',
        email: order.email ?? null,
      })
      .select('id')
      .single()
    if (createErr || !created) {
      console.error('[gang webhook] member create failed', createErr)
      return Response.json({ ok: true, skipped: 'member create failed' })
    }
    memberId = created.id
  }

  const { data: submission, error: subErr } = await supabase
    .from('gang_order_submissions')
    .insert({
      member_id: memberId,
      order_number: orderNumber,
      platform: 'website',
      status: 'valid',
      verified_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (subErr || !submission) {
    // Unique-violation race with a retry — that's fine, it exists.
    return Response.json({ ok: true, skipped: 'submission insert failed' })
  }

  await assignTickets(supabase, [submission.id])

  const validCount = await countValidSubmissions(supabase, memberId)
  if (validCount === 1) {
    await grantFirstTimerCodes(supabase, memberId)
  }

  return Response.json({ ok: true, member_id: memberId, order: orderNumber })
}
