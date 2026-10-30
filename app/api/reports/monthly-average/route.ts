import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isTestStore, loadTestStoreIds } from '@/lib/stores/test-accounts'
import { malaysiaToday } from '@/lib/restock/wayne-calc'
import {
  buildMonthlyAverage, isMonthlyAverageMonths, DEFAULT_MONTHLY_AVERAGE_MONTHS,
  type MonthlyAverageSale, type MonthlyAverageStore,
} from '@/lib/reports/monthly-average'

const PAGE = 1000

/**
 * GET /api/reports/monthly-average[?months=1|2|3|6|12]
 * Admin only. Every store (active and inactive) with its average monthly
 * sales over the last N full calendar months. Filtering by status, type and
 * state happens on the page.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin' && profile?.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const raw = request.nextUrl.searchParams.get('months')
  const months = raw === null ? DEFAULT_MONTHLY_AVERAGE_MONTHS : Number(raw)
  if (!isMonthlyAverageMonths(months)) {
    return Response.json({ error: 'months must be one of 1, 2, 3, 6, 12' }, { status: 400 })
  }

  const { data: stores, error: storesErr } = await supabase
    .from('stores')
    .select('id, store_code, store_name, store_type, state, status')
    .order('store_code')
  if (storesErr) return Response.json({ error: storesErr.message }, { status: 500 })

  // Every sale ever, not only the window: the first sale marks when a store opened.
  const sales: MonthlyAverageSale[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('sales')
      .select('id, store_id, sale_date, quantity, total_amount')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    sales.push(...((data ?? []) as MonthlyAverageSale[]))
    if (!data || data.length < PAGE) break
  }

  const testIds = await loadTestStoreIds(supabase)
  const result = buildMonthlyAverage({
    asOf: malaysiaToday(),
    months,
    stores: ((stores ?? []) as MonthlyAverageStore[]).filter((s) => !isTestStore(testIds, s.id)),
    sales: sales.filter((s) => !isTestStore(testIds, s.store_id)),
  })

  return Response.json(result)
}
