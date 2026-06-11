/**
 * POST /api/commissions/ensure
 * Auto-generates a commission period for a store if it doesn't already exist.
 * Store owners can call this for their own store. Admins can call for any store.
 * Uses service role to bypass RLS for the insert.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const Schema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  store_id: z.string().uuid().optional(),
})

function calcCommission(totalAmount: number, commissionRate: number) {
  const commission = Number((totalAmount * (commissionRate / 100)).toFixed(2))
  return { commission_amount: commission, xocks_revenue: Number((totalAmount - commission).toFixed(2)) }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })

  const { month, year } = parsed.data

  // Determine which store to generate for
  let targetStoreId: string
  if (profile.role === 'store_owner') {
    if (!profile.store_id) return Response.json({ error: 'No store assigned' }, { status: 403 })
    targetStoreId = profile.store_id
  } else if (profile.role === 'super_admin' || profile.role === 'ops_manager') {
    if (!parsed.data.store_id) return Response.json({ error: 'store_id required for admin' }, { status: 400 })
    targetStoreId = parsed.data.store_id
  } else {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const svc = await createServiceClient()

  // Check if period already exists
  const { data: existing } = await svc
    .from('commission_periods')
    .select('id, status, commission_amount, total_revenue, total_units_sold')
    .eq('store_id', targetStoreId)
    .eq('period_month', month)
    .eq('period_year', year)
    .single()

  if (existing) {
    return Response.json({ period: existing, created: false })
  }

  // Fetch store commission rate
  const { data: store } = await svc
    .from('stores')
    .select('commission_rate')
    .eq('id', targetStoreId)
    .single()

  if (!store) return Response.json({ error: 'Store not found' }, { status: 404 })

  // Build date range for the month
  const pad = (n: number) => String(n).padStart(2, '0')
  const startDate = `${year}-${pad(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${pad(month)}-${pad(lastDay)}`

  // Fetch sales for this period
  const { data: sales } = await svc
    .from('sales')
    .select('quantity, total_amount')
    .eq('store_id', targetStoreId)
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)

  const total_units_sold = (sales ?? []).reduce((s, x) => s + x.quantity, 0)
  const total_revenue = Number((sales ?? []).reduce((s, x) => s + x.total_amount, 0).toFixed(2))
  const { commission_amount, xocks_revenue } = calcCommission(total_revenue, store.commission_rate)

  // Create the period
  const { data: period, error } = await svc
    .from('commission_periods')
    .insert({
      store_id: targetStoreId,
      period_month: month,
      period_year: year,
      total_units_sold,
      total_revenue,
      commission_amount,
      xocks_revenue,
      status: 'pending',
    })
    .select('id, status, commission_amount, total_revenue, total_units_sold')
    .single()

  if (error || !period) return Response.json({ error: 'Failed to create period', details: error?.message }, { status: 500 })

  // Notify the store
  await svc.from('notifications').insert({
    recipient_role: null,
    recipient_store_id: targetStoreId,
    type: 'commission_ready',
    title: 'Invoice Ready',
    message: `Your invoice for ${month}/${year} is ready. Your commission: RM${commission_amount.toFixed(2)}. Amount to transfer to Xocks: RM${xocks_revenue.toFixed(2)} — pay before the 7th and upload your receipt.`,
    reference_id: period.id,
    reference_type: 'commission_period',
    is_read: false,
  })

  return Response.json({ period, created: true })
}
