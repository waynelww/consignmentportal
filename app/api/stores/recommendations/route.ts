import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Self-improving recommender:
// 1. Look at sales from nearby stores (same city → same state) in the last 90 days
// 2. Rank products by total units sold; suggest qty proportional to per-store avg
// 3. If there isn't enough nearby signal (< 100 units across all nearby stores),
//    fall back to overall best-sellers across the whole network
// 4. Always include core SKUs as a baseline

const LOOKBACK_DAYS = 90
const MIN_SIGNAL_UNITS = 100   // total units needed to trust "nearby" data
const DEFAULT_QTY_CORE = 12
const DEFAULT_QTY_RECOMMENDED = 12
const DEFAULT_QTY_OTHER = 6

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const state = (searchParams.get('state') || '').trim()
  const city = (searchParams.get('city') || '').trim()

  const adminClient = createAdminClient()

  // Date threshold (90 days ago, YYYY-MM-DD)
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString().split('T')[0]

  // Find nearby store ids
  type NearbyStore = { id: string }
  let nearbyStoreIds: string[] = []
  let nearbyScope: 'city' | 'state' | 'none' = 'none'

  if (city) {
    const { data: cityStores } = await adminClient
      .from('stores')
      .select('id')
      .eq('city', city)
      .eq('status', 'active')

    if (cityStores && cityStores.length > 0) {
      nearbyStoreIds = (cityStores as NearbyStore[]).map((s) => s.id)
      nearbyScope = 'city'
    }
  }

  if (nearbyStoreIds.length === 0 && state) {
    const { data: stateStores } = await adminClient
      .from('stores')
      .select('id')
      .eq('state', state)
      .eq('status', 'active')

    if (stateStores && stateStores.length > 0) {
      nearbyStoreIds = (stateStores as NearbyStore[]).map((s) => s.id)
      nearbyScope = 'state'
    }
  }

  // Aggregate sales — nearby first, fall back to global
  type SalesRow = { product_id: string; quantity: number; store_id: string }
  const aggregate = (rows: SalesRow[], storeCount: number) => {
    const byProduct = new Map<string, { units: number; stores: Set<string> }>()
    for (const r of rows) {
      const entry = byProduct.get(r.product_id) ?? { units: 0, stores: new Set<string>() }
      entry.units += r.quantity
      entry.stores.add(r.store_id)
      byProduct.set(r.product_id, entry)
    }
    return [...byProduct.entries()]
      .map(([product_id, v]) => ({
        product_id,
        total_units: v.units,
        store_coverage: v.stores.size,
        avg_per_store: storeCount > 0 ? v.units / Math.max(storeCount, 1) : 0,
      }))
      .sort((a, b) => b.total_units - a.total_units)
  }

  let signalSource: 'nearby_city' | 'nearby_state' | 'global' = 'global'
  let ranked: { product_id: string; total_units: number; store_coverage: number; avg_per_store: number }[] = []
  let signalStoreCount = 0

  if (nearbyStoreIds.length > 0) {
    const { data: nearbySales } = await adminClient
      .from('sales')
      .select('product_id, quantity, store_id')
      .in('store_id', nearbyStoreIds)
      .gte('sale_date', since)

    const rows = (nearbySales as SalesRow[]) ?? []
    const totalUnits = rows.reduce((s, r) => s + r.quantity, 0)

    if (totalUnits >= MIN_SIGNAL_UNITS) {
      ranked = aggregate(rows, nearbyStoreIds.length)
      signalSource = nearbyScope === 'city' ? 'nearby_city' : 'nearby_state'
      signalStoreCount = nearbyStoreIds.length
    }
  }

  if (ranked.length === 0) {
    // Global fallback — best sellers across whole network
    const { data: allSales } = await adminClient
      .from('sales')
      .select('product_id, quantity, store_id')
      .gte('sale_date', since)

    const rows = (allSales as SalesRow[]) ?? []
    const { data: allStores } = await adminClient
      .from('stores')
      .select('id')
      .eq('status', 'active')
    const storeCount = allStores?.length ?? 1
    ranked = aggregate(rows, storeCount)
    signalStoreCount = storeCount
    signalSource = 'global'
  }

  // Fetch all active products
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('sku')

  const allProducts = products ?? []

  // Build recommendation map
  const recommended = new Set<string>()

  // Always include core SKUs
  for (const p of allProducts) {
    if (p.is_core_sku) recommended.add(p.id)
  }

  // Add top 8 from ranked (if not already core)
  for (const r of ranked.slice(0, 8)) {
    recommended.add(r.product_id)
  }

  // Suggested qty: round up avg/store to nearest 6, min 6, max 48
  const rankedById = new Map(ranked.map((r) => [r.product_id, r]))
  const suggestQty = (productId: string, isCore: boolean) => {
    const r = rankedById.get(productId)
    if (r && r.avg_per_store > 0) {
      // Suggest ~1.5x monthly avg as starting stock, in multiples of 6
      const monthlyAvg = r.avg_per_store / 3 // 90 days → ~3 months
      const suggested = Math.ceil((monthlyAvg * 1.5) / 6) * 6
      return Math.max(6, Math.min(48, suggested))
    }
    return isCore ? DEFAULT_QTY_CORE : DEFAULT_QTY_RECOMMENDED
  }

  // Build response: each product with recommendation metadata
  const enriched = allProducts.map((p) => {
    const isRecommended = recommended.has(p.id)
    const rank = ranked.findIndex((r) => r.product_id === p.id)
    const r = rankedById.get(p.id)

    return {
      ...p,
      is_recommended: isRecommended,
      rank: rank >= 0 ? rank + 1 : null,
      suggested_qty: isRecommended ? suggestQty(p.id, p.is_core_sku) : DEFAULT_QTY_OTHER,
      total_units_sold: r?.total_units ?? 0,
      store_coverage: r?.store_coverage ?? 0,
    }
  })

  // Sort: core first, then recommended-by-rank, then alphabetical SKU
  enriched.sort((a, b) => {
    if (a.is_recommended !== b.is_recommended) return a.is_recommended ? -1 : 1
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank
    if (a.rank !== null) return -1
    if (b.rank !== null) return 1
    return a.sku.localeCompare(b.sku)
  })

  return Response.json({
    products: enriched,
    meta: {
      signal_source: signalSource,
      signal_store_count: signalStoreCount,
      nearby_city: city || null,
      nearby_state: state || null,
      lookback_days: LOOKBACK_DAYS,
    },
  })
}
