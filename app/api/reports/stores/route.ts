import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const monthParam = searchParams.get('month')
  const yearParam = searchParams.get('year')

  if (!monthParam || !yearParam) {
    return Response.json({ error: 'month and year are required' }, { status: 400 })
  }

  const month = parseInt(monthParam, 10)
  const year = parseInt(yearParam, 10)

  if (isNaN(month) || month < 1 || month > 12 || isNaN(year)) {
    return Response.json({ error: 'Invalid month or year' }, { status: 400 })
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Fetch all active stores
  const { data: stores, error: storesErr } = await supabase
    .from('stores')
    .select('id, store_code, store_name, city, state, commission_rate, performance_score, consecutive_low_months, status')
    .order('store_code', { ascending: true })

  if (storesErr) return Response.json({ error: storesErr.message }, { status: 500 })

  if (!stores || stores.length === 0) {
    return Response.json({ stores: [] })
  }

  // Fetch sales for all stores in the period
  const storeIds = stores.map((s) => s.id)
  const { data: sales, error: salesErr } = await supabase
    .from('sales')
    .select('store_id, quantity, total_amount, commission_amount, xocks_revenue')
    .in('store_id', storeIds)
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)

  if (salesErr) return Response.json({ error: salesErr.message }, { status: 500 })

  // Aggregate per store
  type StoreAgg = {
    pairs_sold: number
    revenue: number
    commission: number
    xocks_revenue: number
    transaction_count: number
  }
  const agg = new Map<string, StoreAgg>()
  for (const s of sales ?? []) {
    const existing = agg.get(s.store_id) ?? {
      pairs_sold: 0, revenue: 0, commission: 0, xocks_revenue: 0, transaction_count: 0,
    }
    existing.pairs_sold += s.quantity
    existing.revenue = Number((existing.revenue + s.total_amount).toFixed(2))
    existing.commission = Number((existing.commission + s.commission_amount).toFixed(2))
    existing.xocks_revenue = Number((existing.xocks_revenue + s.xocks_revenue).toFixed(2))
    existing.transaction_count += 1
    agg.set(s.store_id, existing)
  }

  // Fetch commission periods for this month
  const { data: commissionPeriods } = await supabase
    .from('commission_periods')
    .select('store_id, status, commission_amount')
    .in('store_id', storeIds)
    .eq('period_month', month)
    .eq('period_year', year)

  const commissionMap = new Map(
    (commissionPeriods ?? []).map((cp) => [cp.store_id, { status: cp.status, amount: cp.commission_amount }])
  )

  const result = stores.map((store) => {
    const metrics = agg.get(store.id) ?? {
      pairs_sold: 0, revenue: 0, commission: 0, xocks_revenue: 0, transaction_count: 0,
    }
    const commission = commissionMap.get(store.id)

    return {
      store_id: store.id,
      store_code: store.store_code,
      store_name: store.store_name,
      city: store.city,
      state: store.state,
      status: store.status,
      commission_rate: store.commission_rate,
      performance_score: store.performance_score,
      consecutive_low_months: store.consecutive_low_months,
      pairs_sold: metrics.pairs_sold,
      revenue: metrics.revenue,
      commission_earned: metrics.commission,
      xocks_revenue: metrics.xocks_revenue,
      transaction_count: metrics.transaction_count,
      commission_status: commission?.status ?? null,
      commission_amount: commission?.amount ?? null,
    }
  })

  return Response.json({ stores: result, period: { month, year } })
}
