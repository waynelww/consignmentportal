// @ts-nocheck
import { type NextRequest } from 'next/server'
import { createClient as createSSRClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Malaysian public holidays & peak periods by month (1-indexed)
// multiplier: expected demand boost relative to a normal month
const MY_SEASONAL: Record<number, { name: string; multiplier: number }[]> = {
  1:  [{ name: 'New Year', multiplier: 1.15 }],
  2:  [{ name: 'Chinese New Year', multiplier: 1.5 }],
  3:  [{ name: 'Spring school holidays', multiplier: 1.1 }],
  4:  [{ name: 'Hari Raya (typical window)', multiplier: 1.6 }],
  5:  [{ name: 'Hari Raya (typical window)', multiplier: 1.4 }],
  6:  [{ name: 'Mid-year school holidays', multiplier: 1.25 }],
  7:  [{ name: 'School holidays', multiplier: 1.1 }],
  8:  [{ name: 'Merdeka', multiplier: 1.1 }],
  9:  [{ name: 'Malaysia Day', multiplier: 1.1 }],
  10: [{ name: 'Deepavali season', multiplier: 1.2 }],
  11: [{ name: 'Year-end school hols', multiplier: 1.2 }],
  12: [{ name: 'Christmas / Year-end', multiplier: 1.35 }],
}

// Override for years where Hari Raya falls in a different month
// 2026: Hari Raya Aidilfitri ~20 March 2026
const YEAR_OVERRIDES: Record<number, Partial<Record<number, { name: string; multiplier: number }[]>>> = {
  2026: {
    3: [{ name: 'Hari Raya Aidilfitri 2026', multiplier: 1.6 }],
    4: [{ name: 'Hari Raya (tail end)', multiplier: 1.2 }],
  },
}

function getSeasonalMultiplier(year: number, month: number): { multiplier: number; festivals: string[] } {
  const overrides = YEAR_OVERRIDES[year]
  const events = (overrides?.[month] ?? MY_SEASONAL[month] ?? [])
  const festivals = events.map((e) => e.name)
  const multiplier = events.reduce((max, e) => Math.max(max, e.multiplier), 1.0)
  return { multiplier, festivals }
}

export async function GET(request: NextRequest) {
  // Auth check
  const ssr = await createSSRClient()
  const { data: { user }, error: authErr } = await ssr.auth.getUser()
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await ssr
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Admin only' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store_id') // optional filter

  let admin: ReturnType<typeof createClient>
  try { admin = getAdminClient() } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Config error' }, { status: 500 })
  }

  // Determine the target month (next month from today in MY time)
  const myNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
  const targetMonth = myNow.getMonth() + 2 > 12 ? 1 : myNow.getMonth() + 2  // 1-indexed next month
  const targetYear = myNow.getMonth() + 2 > 12 ? myNow.getFullYear() + 1 : myNow.getFullYear()
  const { multiplier: seasonalMultiplier, festivals } = getSeasonalMultiplier(targetYear, targetMonth)

  // Fetch last 3 months of sales
  const threeMonthsAgo = new Date(myNow)
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const fromDate = threeMonthsAgo.toISOString().slice(0, 10)

  let salesQuery = admin
    .from('sales')
    .select('store_id, product_id, quantity, sale_date')
    .gte('sale_date', fromDate)

  if (storeId) salesQuery = salesQuery.eq('store_id', storeId)

  const { data: sales, error: salesErr } = await salesQuery
  if (salesErr) return Response.json({ error: salesErr.message }, { status: 500 })

  // Aggregate: total sold per (store, product) over 3 months → avg monthly velocity
  const velocity: Record<string, Record<string, number>> = {}
  for (const s of sales ?? []) {
    if (!velocity[s.store_id]) velocity[s.store_id] = {}
    velocity[s.store_id][s.product_id] = (velocity[s.store_id][s.product_id] || 0) + s.quantity
  }

  // Fetch current inventory
  let invQuery = admin
    .from('store_inventory')
    .select('store_id, product_id, quantity_on_hand')
  if (storeId) invQuery = invQuery.eq('store_id', storeId)
  const { data: inventory } = await invQuery

  const invMap: Record<string, Record<string, number>> = {}
  for (const i of inventory ?? []) {
    if (!invMap[i.store_id]) invMap[i.store_id] = {}
    invMap[i.store_id][i.product_id] = i.quantity_on_hand
  }

  // Fetch stores and products for display names
  const storeIds = [...new Set((sales ?? []).map((s) => s.store_id))]
  const productIds = [...new Set((sales ?? []).map((s) => s.product_id))]

  const [{ data: stores }, { data: products }] = await Promise.all([
    admin.from('stores').select('id, store_name, store_code').in('id', storeIds.length ? storeIds : ['none']),
    admin.from('products').select('id, name, sku').in('id', productIds.length ? productIds : ['none']),
  ])

  const storeMap = Object.fromEntries((stores ?? []).map((s) => [s.id, s]))
  const productMap = Object.fromEntries((products ?? []).map((p) => [p.id, p]))

  // Build suggestions
  const suggestions: {
    store_id: string
    store_name: string
    store_code: string
    product_id: string
    product_name: string
    sku: string
    avg_monthly_sales: number
    projected_demand: number
    current_stock: number
    suggested_restock: number
    seasonal_multiplier: number
    festivals: string[]
  }[] = []

  for (const [sid, products_vel] of Object.entries(velocity)) {
    const store = storeMap[sid]
    if (!store) continue

    for (const [pid, totalSold] of Object.entries(products_vel)) {
      const product = productMap[pid]
      if (!product) continue

      const avgMonthlySales = Math.round(totalSold / 3)
      if (avgMonthlySales === 0) continue

      const projectedDemand = Math.ceil(avgMonthlySales * seasonalMultiplier)
      const currentStock = invMap[sid]?.[pid] ?? 0
      const suggestedRestock = Math.max(0, projectedDemand - currentStock)

      if (suggestedRestock > 0) {
        suggestions.push({
          store_id: sid,
          store_name: store.store_name,
          store_code: store.store_code,
          product_id: pid,
          product_name: product.name,
          sku: product.sku,
          avg_monthly_sales: avgMonthlySales,
          projected_demand: projectedDemand,
          current_stock: currentStock,
          suggested_restock: suggestedRestock,
          seasonal_multiplier: seasonalMultiplier,
          festivals,
        })
      }
    }
  }

  // Sort: highest restock need first
  suggestions.sort((a, b) => b.suggested_restock - a.suggested_restock)

  return Response.json({
    target_month: targetMonth,
    target_year: targetYear,
    seasonal_multiplier: seasonalMultiplier,
    festivals,
    suggestions,
    generated_at: new Date().toISOString(),
  })
}
