import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/bot/store-performance/[storeId]
// Returns: 30/60/90-day sales trend, sell-through, restock cadence, top SKUs, current stock
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const { storeId } = await params
  const supabase = createAdminClient()

  const { data: store, error: storeErr } = await supabase
    .from('stores')
    .select('id, store_code, store_name, store_type, city, state, status, commission_rate, performance_score, consecutive_low_months, created_at')
    .eq('id', storeId)
    .single()

  if (storeErr || !store) return Response.json({ error: 'Store not found' }, { status: 404 })

  const [d30, d60, d90] = [30, 60, 90].map(daysAgo)

  const { data: sales } = await supabase
    .from('sales')
    .select('sale_date, quantity, total_amount, xocks_revenue, products:product_id ( id, sku, name )')
    .eq('store_id', storeId)
    .gte('sale_date', d90)

  const { data: inventory } = await supabase
    .from('store_inventory')
    .select('quantity_on_hand, restock_threshold, last_restocked_at, products:product_id ( sku, name )')
    .eq('store_id', storeId)

  const { data: restocks } = await supabase
    .from('delivery_orders')
    .select('do_type, dispatch_date, delivery_date, total_pairs')
    .eq('store_id', storeId)
    .eq('do_type', 'restock')
    .order('dispatch_date', { ascending: false })
    .limit(10)

  const salesRows = sales ?? []
  const window = (since: string) => salesRows.filter((s) => s.sale_date >= since)
  const sumOf = (rows: typeof salesRows) =>
    rows.reduce(
      (acc, r) => {
        acc.units += r.quantity
        acc.revenue += Number(r.total_amount)
        acc.xocks_revenue += Number(r.xocks_revenue)
        return acc
      },
      { units: 0, revenue: 0, xocks_revenue: 0 },
    )

  const last30 = sumOf(window(d30))
  const last60 = sumOf(window(d60))
  const last90 = sumOf(window(d90))
  const prev30 = { units: last60.units - last30.units, revenue: last60.revenue - last30.revenue }
  const trend30vPrev = prev30.revenue > 0 ? ((last30.revenue - prev30.revenue) / prev30.revenue) * 100 : null

  // Top SKUs in last 90 days
  const skuMap: Record<string, { sku: string; name: string; units: number; revenue: number }> = {}
  for (const r of salesRows) {
    const p = r.products as { id?: string; sku?: string; name?: string } | null
    const key = p?.id ?? 'unknown'
    if (!skuMap[key]) skuMap[key] = { sku: p?.sku ?? '—', name: p?.name ?? 'Unknown', units: 0, revenue: 0 }
    skuMap[key].units += r.quantity
    skuMap[key].revenue += Number(r.total_amount)
  }
  const topSkus = Object.values(skuMap).sort((a, b) => b.units - a.units).slice(0, 5)

  // Stock + sell-through
  const stockRows = inventory ?? []
  const totalOnHand = stockRows.reduce((s, r) => s + r.quantity_on_hand, 0)
  const belowThreshold = stockRows.filter((r) => r.quantity_on_hand <= r.restock_threshold).length

  // Restock cadence (avg days between dispatches)
  const restockDates = (restocks ?? []).map((r) => r.dispatch_date).filter(Boolean) as string[]
  let avgRestockDays: number | null = null
  if (restockDates.length >= 2) {
    const gaps: number[] = []
    for (let i = 0; i < restockDates.length - 1; i++) {
      const a = new Date(restockDates[i]).getTime()
      const b = new Date(restockDates[i + 1]).getTime()
      gaps.push(Math.abs(a - b) / (1000 * 60 * 60 * 24))
    }
    avgRestockDays = Math.round(gaps.reduce((s, n) => s + n, 0) / gaps.length)
  }

  return Response.json({
    store,
    sales: {
      last_30_days: round(last30),
      last_60_days: round(last60),
      last_90_days: round(last90),
      trend_30d_vs_prev30d_pct: trend30vPrev !== null ? Math.round(trend30vPrev * 10) / 10 : null,
    },
    top_skus_90d: topSkus,
    inventory: {
      total_on_hand: totalOnHand,
      skus_below_threshold: belowThreshold,
      total_skus: stockRows.length,
    },
    restock_history: {
      recent_dispatches: restocks ?? [],
      avg_days_between_restocks: avgRestockDays,
    },
  })
}

function daysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function round<T extends Record<string, number>>(o: T): T {
  const out = {} as Record<string, number>
  for (const [k, v] of Object.entries(o)) out[k] = Math.round(v * 100) / 100
  return out as T
}
