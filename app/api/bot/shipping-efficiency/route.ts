import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/bot/shipping-efficiency?days=180
// For each active store: restock frequency vs revenue.
// Flags stores where restock cost is eating margin.
// Powers Wayne's UC2 question: "Which stores are killing our shipping margins?"
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const days = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('days') ?? '180', 10), 30), 365)
  const since = daysAgoIso(days)
  const supabase = createAdminClient()

  const { data: stores, error: storesErr } = await supabase
    .from('stores')
    .select('id, store_code, store_name, store_type, state, status')
    .eq('status', 'active')

  if (storesErr) return Response.json({ error: storesErr.message }, { status: 500 })

  const storeIds = (stores ?? []).map((s) => s.id)
  if (storeIds.length === 0) return Response.json({ stores: [], period_days: days })

  const [{ data: sales }, { data: restocks }] = await Promise.all([
    supabase
      .from('sales')
      .select('store_id, quantity, total_amount, xocks_revenue, sale_date')
      .in('store_id', storeIds)
      .gte('sale_date', since),
    supabase
      .from('delivery_orders')
      .select('store_id, dispatch_date, total_pairs, do_type')
      .in('store_id', storeIds)
      .in('do_type', ['restock', 'initial'])
      .gte('dispatch_date', since),
  ])

  const salesByStore: Record<string, { units: number; revenue: number; xocks_revenue: number }> = {}
  for (const s of sales ?? []) {
    if (!salesByStore[s.store_id]) salesByStore[s.store_id] = { units: 0, revenue: 0, xocks_revenue: 0 }
    salesByStore[s.store_id].units += s.quantity
    salesByStore[s.store_id].revenue += Number(s.total_amount)
    salesByStore[s.store_id].xocks_revenue += Number(s.xocks_revenue)
  }

  const restocksByStore: Record<string, { count: number; total_pairs: number; dates: string[] }> = {}
  for (const r of restocks ?? []) {
    if (!restocksByStore[r.store_id]) restocksByStore[r.store_id] = { count: 0, total_pairs: 0, dates: [] }
    restocksByStore[r.store_id].count += 1
    restocksByStore[r.store_id].total_pairs += r.total_pairs
    if (r.dispatch_date) restocksByStore[r.store_id].dates.push(r.dispatch_date)
  }

  const out = (stores ?? []).map((store) => {
    const sales = salesByStore[store.id] ?? { units: 0, revenue: 0, xocks_revenue: 0 }
    const restock = restocksByStore[store.id] ?? { count: 0, total_pairs: 0, dates: [] }

    const restockCadenceDays = computeCadence(restock.dates)
    const xocksRevPerRestock = restock.count > 0 ? sales.xocks_revenue / restock.count : 0

    // Heuristic flag: many restocks but low revenue per restock
    const flag =
      restock.count >= 3 && xocksRevPerRestock < 200
        ? 'shipping_drag'
        : sales.revenue === 0 && restock.count > 0
          ? 'dead_stock'
          : 'ok'

    return {
      store_id: store.id,
      store_code: store.store_code,
      store_name: store.store_name,
      store_type: store.store_type,
      state: store.state,
      units_sold: sales.units,
      revenue_rm: round(sales.revenue),
      xocks_revenue_rm: round(sales.xocks_revenue),
      restock_count: restock.count,
      total_pairs_shipped: restock.total_pairs,
      avg_days_between_restocks: restockCadenceDays,
      xocks_revenue_per_restock_rm: round(xocksRevPerRestock),
      flag,
    }
  })

  out.sort((a, b) => {
    if (a.flag === b.flag) return b.xocks_revenue_per_restock_rm - a.xocks_revenue_per_restock_rm
    const order = { shipping_drag: 0, dead_stock: 1, ok: 2 }
    return order[a.flag as keyof typeof order] - order[b.flag as keyof typeof order]
  })

  return Response.json({
    period_days: days,
    flagged_count: out.filter((s) => s.flag !== 'ok').length,
    stores: out,
  })
}

function computeCadence(dates: string[]): number | null {
  if (dates.length < 2) return null
  const sorted = [...dates].sort()
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const a = new Date(sorted[i - 1]).getTime()
    const b = new Date(sorted[i]).getTime()
    gaps.push(Math.abs(b - a) / (1000 * 60 * 60 * 24))
  }
  return Math.round(gaps.reduce((s, n) => s + n, 0) / gaps.length)
}

function daysAgoIso(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function round(n: number) {
  return Math.round(n * 100) / 100
}
