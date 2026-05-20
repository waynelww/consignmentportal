/**
 * GET /api/cron/generate-commissions
 * Called by Vercel Cron on the 2nd of each month.
 * Generates commission periods for all active stores for the previous month.
 */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

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
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()

  const pad = (n: number) => String(n).padStart(2, '0')
  const startDate = `${prevYear}-${pad(prevMonth)}-01`
  const lastDay = new Date(prevYear, prevMonth, 0).getDate()
  const endDate = `${prevYear}-${pad(prevMonth)}-${pad(lastDay)}`

  const { data: stores } = await svc
    .from('stores')
    .select('id, commission_rate')
    .eq('status', 'active')

  let generated = 0
  let skipped = 0

  for (const store of stores ?? []) {
    // Skip if already exists
    const { data: existing } = await svc
      .from('commission_periods')
      .select('id')
      .eq('store_id', store.id)
      .eq('period_month', prevMonth)
      .eq('period_year', prevYear)
      .single()

    if (existing) { skipped++; continue }

    const { data: sales } = await svc
      .from('sales')
      .select('quantity, total_amount')
      .eq('store_id', store.id)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate)

    const total_units_sold = (sales ?? []).reduce((s, x) => s + x.quantity, 0)
    const total_revenue = Number((sales ?? []).reduce((s, x) => s + x.total_amount, 0).toFixed(2))
    const { commission_amount, xocks_revenue } = calcCommission(total_revenue, store.commission_rate)

    const { data: period, error } = await svc
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

    if (error || !period) continue

    generated++

    // Notify store
    await svc.from('notifications').insert({
      recipient_role: null,
      recipient_store_id: store.id,
      type: 'commission_ready',
      title: 'Invoice Ready',
      message: `Your invoice for ${prevMonth}/${prevYear} is ready. Commission earned: RM${commission_amount.toFixed(2)}`,
      reference_id: period.id,
      reference_type: 'commission_period',
      is_read: false,
    })

    // Notify admin
    await svc.from('notifications').insert({
      recipient_role: 'super_admin',
      recipient_store_id: null,
      type: 'commission_ready',
      title: 'Commission Generated',
      message: `Invoice generated for store — ${prevMonth}/${prevYear}: RM${commission_amount.toFixed(2)}`,
      reference_id: period.id,
      reference_type: 'commission_period',
      is_read: false,
    })
  }

  return Response.json({ success: true, generated, skipped, month: prevMonth, year: prevYear })
}
