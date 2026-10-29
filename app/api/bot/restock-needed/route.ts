import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { cachedAdminJson } from '@/lib/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { describeCode, embedded } from '@/lib/restock/low-stock'
import { loadLowStockSettings } from '@/lib/restock/low-stock-settings'

// GET /api/bot/restock-needed
// Returns: every store/SKU currently low or out under the low-stock rule
// (lib/restock/low-stock.ts), grouped by urgency.
// Field change: `restock_threshold` (raw DB column) is now `low_threshold`,
// the computed level below which a code counts as low, and `stocked_level`
// is the code's effective stocked level.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const supabase = createAdminClient()
  const settings = await loadLowStockSettings(supabase)

  const { data, error } = await supabase
    .from('store_inventory')
    .select(`
      quantity_on_hand,
      stocked_level,
      plan_level,
      last_restocked_at,
      stores:store_id ( id, store_code, store_name, store_type, state, city, status, pairs_per_code, on_stock_plan ),
      products:product_id ( id, sku, name, category )
    `)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const items = (data ?? [])
    .flatMap((r) => {
      const s = embedded(r.stores as never) as { id: string; store_code: string; store_name: string; store_type: string; state: string; city: string; status: string; pairs_per_code: number; on_stock_plan: boolean } | null
      if (!s || s.status !== 'active') return []
      const low = describeCode(r, s, settings.pct)
      if (low.status === 'in_stock') return []
      const p = embedded(r.products as never) as { id: string; sku: string; name: string; category: string } | null
      const urgency = low.status === 'out_of_stock'
        ? 'critical'
        : r.quantity_on_hand <= low.threshold / 2
          ? 'high'
          : 'medium'
      return [{
        store_id: s.id,
        store_code: s.store_code,
        store_name: s.store_name,
        store_type: s.store_type,
        state: s.state,
        city: s.city,
        sku: p?.sku,
        product_name: p?.name,
        category: p?.category,
        quantity_on_hand: r.quantity_on_hand,
        stocked_level: low.stocked,
        low_threshold: Math.floor(low.threshold),
        last_restocked_at: r.last_restocked_at,
        urgency,
      }]
    })
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2 }
      return order[a.urgency as keyof typeof order] - order[b.urgency as keyof typeof order]
    })

  const summary = items.reduce(
    (acc, i) => {
      acc[i.urgency] = (acc[i.urgency] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  // Stores grouped — useful for "who needs a restock dispatch"
  const byStore: Record<string, { store_name: string; store_code: string; skus: number; critical: number; high: number; medium: number }> = {}
  for (const i of items) {
    const key = i.store_id ?? 'unknown'
    if (!byStore[key]) {
      byStore[key] = {
        store_name: i.store_name ?? 'Unknown',
        store_code: i.store_code ?? '—',
        skus: 0, critical: 0, high: 0, medium: 0,
      }
    }
    byStore[key].skus += 1
    byStore[key][i.urgency as 'critical' | 'high' | 'medium'] += 1
  }

  return cachedAdminJson({
    summary,
    total_skus_needing_restock: items.length,
    stores_affected: Object.keys(byStore).length,
    by_store: byStore,
    items,
  })
}
