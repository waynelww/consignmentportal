/**
 * GET /api/cron/generate-commissions
 * Called by Vercel Cron on the 1st of each month at 01:00 UTC.
 * For each active store:
 *   1. Generates a commission period for the previous month
 *   2. Inserts in-app notifications (store + admin)
 *   3. Sends commission statement email to the store owner
 *   4. Sends Web Push notification to all subscribed store devices
 */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendCommissionStatementEmail } from '@/lib/email/send-email'
import { sendPushToStore } from '@/lib/push/send-push'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function calcCommission(totalAmount: number, commissionRate: number) {
  const commission = Number((totalAmount * (commissionRate / 100)).toFixed(2))
  return { commission_amount: commission, xocks_revenue: Number((totalAmount - commission).toFixed(2)) }
}

export async function GET(request: NextRequest) {
  // Protect cron endpoint
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = await createServiceClient()

  // Generate for the PREVIOUS month
  const now = new Date()
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
  const prevYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const monthName = MONTH_NAMES[prevMonth - 1]

  const pad = (n: number) => String(n).padStart(2, '0')
  const startDate = `${prevYear}-${pad(prevMonth)}-01`
  const lastDay   = new Date(prevYear, prevMonth, 0).getDate()
  const endDate   = `${prevYear}-${pad(prevMonth)}-${pad(lastDay)}`

  const { data: stores } = await svc
    .from('stores')
    .select('id, store_name, store_code, email, commission_rate')
    .eq('status', 'active')

  let generated = 0
  let skipped   = 0
  let emails    = 0
  let pushSent  = 0

  for (const store of stores ?? []) {
    // ── 1. Skip if period already exists ─────────────────────────────────────
    const { data: existing } = await svc
      .from('commission_periods')
      .select('id')
      .eq('store_id', store.id)
      .eq('period_month', prevMonth)
      .eq('period_year', prevYear)
      .single()

    if (existing) { skipped++; continue }

    // ── 2. Aggregate sales for the period ─────────────────────────────────────
    const { data: sales } = await svc
      .from('sales')
      .select('quantity, total_amount')
      .eq('store_id', store.id)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate)

    const total_units_sold = (sales ?? []).reduce((s, x) => s + x.quantity, 0)
    const total_revenue    = Number((sales ?? []).reduce((s, x) => s + x.total_amount, 0).toFixed(2))
    const { commission_amount, xocks_revenue } = calcCommission(total_revenue, store.commission_rate)

    // ── 3. Insert commission period ───────────────────────────────────────────
    const { data: period, error: periodErr } = await svc
      .from('commission_periods')
      .insert({
        store_id: store.id,
        period_month: prevMonth,
        period_year: prevYear,
        total_units_sold,
        total_revenue,
        commission_amount,
        xocks_revenue,
        status: 'pending',
      })
      .select('id')
      .single()

    if (periodErr || !period) continue

    generated++

    const amountStr = `RM ${commission_amount.toFixed(2)}`

    // ── 4. In-app notification → store ────────────────────────────────────────
    await svc.from('notifications').insert({
      recipient_role: null,
      recipient_store_id: store.id,
      type: 'commission_ready',
      title: `Invoice Ready — ${monthName} ${prevYear}`,
      message: `Your commission statement for ${monthName} ${prevYear} is ready. Commission earned: ${amountStr}. Please transfer to Xocks.`,
      reference_id: period.id,
      reference_type: 'commission_period',
      is_read: false,
    })

    // ── 5. In-app notification → admin ────────────────────────────────────────
    await svc.from('notifications').insert({
      recipient_role: 'super_admin',
      recipient_store_id: null,
      type: 'commission_ready',
      title: 'Commission Generated',
      message: `${store.store_name} (${store.store_code}) — ${monthName} ${prevYear}: ${amountStr}`,
      reference_id: period.id,
      reference_type: 'commission_period',
      is_read: false,
    })

    // ── 6. Email → store owner ────────────────────────────────────────────────
    if (store.email) {
      try {
        await sendCommissionStatementEmail({
          to: store.email,
          storeName: store.store_name,
          month: monthName,
          year: prevYear,
          commissionAmount: commission_amount,
          pdfUrl: `${process.env.NEXT_PUBLIC_APP_URL}/store/commissions`,
        })
        emails++
      } catch (err) {
        console.error(`[cron] email failed for ${store.store_code}:`, err)
      }
    }

    // ── 7. Web Push → store devices ───────────────────────────────────────────
    const { data: subs } = await svc
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('store_id', store.id)

    if (subs && subs.length > 0) {
      const { sent, expired } = await sendPushToStore(subs, {
        title: `Invoice Ready — ${monthName} ${prevYear}`,
        body: `${store.store_name}: commission ${amountStr}. Tap to view your invoice.`,
        url: '/store/commissions',
        tag: `commission-${period.id}`,
      })
      pushSent += sent

      // Clean up expired / revoked subscriptions
      if (expired.length > 0) {
        await svc.from('push_subscriptions').delete().in('endpoint', expired)
      }
    }
  }

  console.log(`[cron] generated=${generated} skipped=${skipped} emails=${emails} push=${pushSent} month=${prevMonth}/${prevYear}`)

  return Response.json({
    success: true,
    generated,
    skipped,
    emails,
    pushSent,
    month: prevMonth,
    year: prevYear,
  })
}
