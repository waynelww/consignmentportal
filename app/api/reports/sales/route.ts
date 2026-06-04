import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cachedAdminJson } from '@/lib/cache'

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
  const start_date = searchParams.get('start_date')
  const end_date = searchParams.get('end_date')
  const store_id = searchParams.get('store_id')
  const product_id = searchParams.get('product_id')
  const state = searchParams.get('state')

  if (!start_date || !end_date) {
    return Response.json({ error: 'start_date and end_date are required' }, { status: 400 })
  }

  let query = supabase
    .from('sales')
    .select(`
      id,
      quantity,
      unit_price,
      total_amount,
      commission_amount,
      xocks_revenue,
      payment_method,
      sale_date,
      store_id,
      product_id,
      products:product_id ( name, sku, category ),
      stores:store_id ( store_name, store_code, store_type, state )
    `)
    .gte('sale_date', start_date)
    .lte('sale_date', end_date)
    .order('sale_date', { ascending: true })

  if (store_id) query = query.eq('store_id', store_id)
  if (product_id) query = query.eq('product_id', product_id)

  const { data: sales, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const filteredSales = state
    ? (sales ?? []).filter((s) => (s.stores as unknown as { state: string } | null)?.state === state)
    : (sales ?? [])

  // Aggregate by day
  const dailyMap = new Map<string, { date: string; pairs: number; revenue: number }>()
  for (const s of filteredSales) {
    const date = s.sale_date
    const existing = dailyMap.get(date) ?? { date, pairs: 0, revenue: 0 }
    existing.pairs += s.quantity
    existing.revenue = Number((existing.revenue + s.total_amount).toFixed(2))
    dailyMap.set(date, existing)
  }
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  // Aggregate by store type
  const storeTypeMap = new Map<string, { store_type: string; pairs: number; revenue: number }>()
  for (const s of filteredSales) {
    const storeType = (s.stores as unknown as { store_type: string } | null)?.store_type ?? 'unknown'
    const existing = storeTypeMap.get(storeType) ?? { store_type: storeType, pairs: 0, revenue: 0 }
    existing.pairs += s.quantity
    existing.revenue = Number((existing.revenue + s.total_amount).toFixed(2))
    storeTypeMap.set(storeType, existing)
  }
  const by_store_type = Array.from(storeTypeMap.values())

  // Aggregate by SKU
  const skuMap = new Map<string, { sku: string; name: string; pairs: number; revenue: number }>()
  for (const s of filteredSales) {
    const prod = s.products as unknown as { sku: string; name: string } | null
    const sku = prod?.sku ?? 'unknown'
    const existing = skuMap.get(sku) ?? { sku, name: prod?.name ?? '', pairs: 0, revenue: 0 }
    existing.pairs += s.quantity
    existing.revenue = Number((existing.revenue + s.total_amount).toFixed(2))
    skuMap.set(sku, existing)
  }
  const by_sku = Array.from(skuMap.values()).sort((a, b) => b.pairs - a.pairs)

  // Aggregate by state
  const stateMap = new Map<string, { state: string; pairs: number; revenue: number }>()
  for (const s of filteredSales) {
    const storeState = (s.stores as unknown as { state: string } | null)?.state ?? 'unknown'
    const existing = stateMap.get(storeState) ?? { state: storeState, pairs: 0, revenue: 0 }
    existing.pairs += s.quantity
    existing.revenue = Number((existing.revenue + s.total_amount).toFixed(2))
    stateMap.set(storeState, existing)
  }
  const by_state = Array.from(stateMap.values()).sort((a, b) => b.revenue - a.revenue)

  const totals = {
    total_pairs: filteredSales.reduce((sum, s) => sum + s.quantity, 0),
    total_revenue: Number(filteredSales.reduce((sum, s) => sum + s.total_amount, 0).toFixed(2)),
    total_commission: Number(filteredSales.reduce((sum, s) => sum + s.commission_amount, 0).toFixed(2)),
    total_xocks_revenue: Number(filteredSales.reduce((sum, s) => sum + s.xocks_revenue, 0).toFixed(2)),
    transaction_count: filteredSales.length,
  }

  return cachedAdminJson({ daily, by_store_type, by_sku, by_state, totals })
}
