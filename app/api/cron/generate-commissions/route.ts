/**
 * GET /api/cron/generate-commissions
 * Vercel Cron: 1st of each month at 01:00 UTC.
 *
 * Strategy (scales to ~1000 active stores in well under 60s):
 *   1. Critical path runs in parallel batches of CONCURRENCY stores:
 *        - skip-if-exists check
 *        - sales aggregation
 *        - commission_periods INSERT
 *        - in-app notifications (both store + admin)
 *   2. Email + Web Push are queued via `after()` so the response can
 *      return immediately and Vercel keeps the function alive in the
 *      background — no extra cost, no extra timeout pressure.
 */
import { type NextRequest } from 'next/server'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendCommissionStatementEmail } from '@/lib/email/send-email'
import { sendPushToStore } from '@/lib/push/send-push'

export const maxDuration = 300 // 5 min — well above what we need, gives headroom

const CONCURRENCY = 8 // 8 stores processed in parallel per batch

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function calcCommission(totalAmount: number, commissionRate: number) {
  const commission = Number((totalAmount * (commissionRate / 100)).toFixed(2))
  return { commission_amount: commission, xocks_revenue: Number((totalAmount - commission).toFixed(2)) }
}

async function chunkedAll<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size)
    const settled = await Promise.allSettled(slice.map(fn))
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value)
      else console.error('[cron generate-commissions] batch item failed:', s.reason)
    }
  }
  return results
}

interface StoreRow {
  id: string
  store_name: string
  store_code: string
  email: string | null
  commission_rate: number
}

interface CommissionResult {
  store: StoreRow
  period_id: string
  commission_amount: number
}

export async function GET(request: NextRequest) {
  // Protect cron endpoint
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  const svc = await createServiceClient()

  // Generate for the PREVIOUS month
  const now = new Date()
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const monthName = MONTH_NAMES[prevMonth - 1]

  const pad = (n: number) => String(n).padStart(2, '0')
  const startDate = `${prevYear}-${pad(prevMonth)}-01`
  const lastDay = new Date(prevYear, prevMonth, 0).getDate()
  const endDate = `${prevYear}-${pad(prevMonth)}-${pad(lastDay)}`

  const { data: stores } = await svc
    .from('stores')
    .select('id, store_name, store_code, email, commission_rate')
    .eq('status', 'active')

  const storeList: StoreRow[] = (stores ?? []) as StoreRow[]
  let skipped = 0

  // Critical path: generate the period + in-app notifications, in parallel batches.
  const generated: CommissionResult[] = []

  const processed = await chunkedAll(storeList, CONCURRENCY, async (store): Promise<CommissionResult | null> => {
    // Skip if period already exists
    const { data: existing } = await svc
      .from('commission_periods')
      .select('id')
      .eq('store_id', store.id)
      .eq('period_month', prevMonth)
      .eq('period_year', prevYear)
      .maybeSingle()

    if (existing) {
      skipped++
      return null
    }

    // Aggregate sales for the period
    const { data: sales } = await svc
      .from('sales')
      .select('quantity, total_amount')
      .eq('store_id', store.id)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate)

    const total_units_sold = (sales ?? []).reduce((s, x) => s + x.quantity, 0)
    const total_revenue = Number((sales ?? []).reduce((s, x) => s + x.total_amount, 0).toFixed(2))
    const { commission_amount, xocks_revenue } = calcCommission(total_revenue, store.commission_rate)

    // Insert commission period
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

    if (periodErr || !period) return null

    const amountStr = `RM ${commission_amount.toFixed(2)}`

    // Two in-app notifications (store + admin) — also batched in parallel
    await Promise.all([
      svc.from('notifications').insert({
        recipient_role: null,
        recipient_store_id: store.id,
        type: 'commission_ready',
        title: `Invoice Ready — ${monthName} ${prevYear}`,
        message: `Your commission statement for ${monthName} ${prevYear} is ready. Commission earned: ${amountStr}. Please transfer to Xocks.`,
        reference_id: period.id,
        reference_type: 'commission_period',
        is_read: false,
      }),
      svc.from('notifications').insert({
        recipient_role: 'super_admin',
        recipient_store_id: null,
        type: 'commission_ready',
        title: 'Commission Generated',
        message: `${store.store_name} (${store.store_code}) — ${monthName} ${prevYear}: ${amountStr}`,
        reference_id: period.id,
        reference_type: 'commission_period',
        is_read: false,
      }),
    ])

    return { store, period_id: period.id, commission_amount }
  })

  for (const p of processed) if (p) generated.push(p)

  // Background fan-out: emails + push are slower (especially email — Resend
  // takes ~500ms each). after() keeps Vercel running them concurrently
  // without blocking the response. If anything fails it's logged but doesn't
  // affect the cron's success status.
  after(async () => {
    let emails = 0
    let pushSent = 0

    await chunkedAll(generated, CONCURRENCY, async ({ store, period_id, commission_amount }) => {
      const amountStr = `RM ${commission_amount.toFixed(2)}`

      // Email
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

      // Web Push
      const { data: subs } = await svc
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('store_id', store.id)

      if (subs && subs.length > 0) {
        try {
          const { sent, expired } = await sendPushToStore(subs, {
            title: `Invoice Ready — ${monthName} ${prevYear}`,
            body: `${store.store_name}: commission ${amountStr}. Tap to view your invoice.`,
            url: '/store/commissions',
            tag: `commission-${period_id}`,
          })
          pushSent += sent
          if (expired.length > 0) {
            await svc.from('push_subscriptions').delete().in('endpoint', expired)
          }
        } catch (err) {
          console.error(`[cron] push failed for ${store.store_code}:`, err)
        }
      }
    })

    console.log(
      `[cron generate-commissions] background fan-out done · ` +
      `emails=${emails} push=${pushSent}`,
    )
  })

  const critical_ms = Date.now() - start
  console.log(
    `[cron generate-commissions] critical path done · ` +
    `generated=${generated.length} skipped=${skipped} stores=${storeList.length} · ${critical_ms}ms`,
  )

  return Response.json({
    success: true,
    generated: generated.length,
    skipped,
    stores_processed: storeList.length,
    critical_path_ms: critical_ms,
    month: prevMonth,
    year: prevYear,
    note: 'Emails and push notifications are sent in the background after this response.',
  })
}
