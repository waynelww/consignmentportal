import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { cachedAdminJson } from '@/lib/cache'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/bot/store-patterns?days=90
// Surfaces patterns: which SKU sells in which store type, which state prefers what.
// Powers questions like: "Which SKUs work for fashion boutiques?" or "What sells in Selangor?"
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const days = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('days') ?? '90', 10), 7), 365)
  const since = daysAgoIso(days)
  const supabase = createAdminClient()

  const { data: sales, error } = await supabase
    .from('sales')
    .select(`
      quantity,
      total_amount,
      sale_date,
      stores:store_id ( store_type, state ),
      products:product_id ( sku, name, category )
    `)
    .gte('sale_date', since)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  type Bucket = { units: number; revenue: number }
  const skuByStoreType: Record<string, Record<string, Bucket>> = {}
  const skuByState: Record<string, Record<string, Bucket>> = {}
  const categoryByStoreType: Record<string, Record<string, Bucket>> = {}

  for (const r of sales ?? []) {
    const s = r.stores as { store_type?: string; state?: string } | null
    const p = r.products as { name?: string; sku?: string; category?: string } | null
    const storeType = s?.store_type ?? 'unknown'
    const state = s?.state ?? 'unknown'
    const skuLabel = p?.name ?? p?.sku ?? 'unknown'
    const category = p?.category ?? 'unknown'

    addTo(skuByStoreType, storeType, skuLabel, r.quantity, Number(r.total_amount))
    addTo(skuByState, state, skuLabel, r.quantity, Number(r.total_amount))
    addTo(categoryByStoreType, storeType, category, r.quantity, Number(r.total_amount))
  }

  return cachedAdminJson({
    period_days: days,
    since,
    sku_by_store_type: rankNested(skuByStoreType),
    sku_by_state: rankNested(skuByState),
    category_by_store_type: rankNested(categoryByStoreType),
  })
}

function addTo(
  bucket: Record<string, Record<string, { units: number; revenue: number }>>,
  outer: string,
  inner: string,
  units: number,
  revenue: number,
) {
  if (!bucket[outer]) bucket[outer] = {}
  if (!bucket[outer][inner]) bucket[outer][inner] = { units: 0, revenue: 0 }
  bucket[outer][inner].units += units
  bucket[outer][inner].revenue += revenue
}

function rankNested(bucket: Record<string, Record<string, { units: number; revenue: number }>>) {
  const out: Record<string, Array<{ label: string; units: number; revenue: number }>> = {}
  for (const [outer, inner] of Object.entries(bucket)) {
    out[outer] = Object.entries(inner)
      .map(([label, v]) => ({ label, units: v.units, revenue: Math.round(v.revenue * 100) / 100 }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 10)
  }
  return out
}

function daysAgoIso(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}
