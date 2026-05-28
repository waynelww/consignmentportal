import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/bot/restock-needed
// Returns: every store/SKU currently at or below threshold, grouped by urgency.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('store_inventory')
    .select(`
      quantity_on_hand,
      restock_threshold,
      last_restocked_at,
      stores:store_id ( id, store_code, store_name, store_type, state, city, status ),
      products:product_id ( id, sku, name, category )
    `)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const items = (data ?? [])
    .filter((r) => r.quantity_on_hand <= r.restock_threshold)
    .filter((r) => {
      const s = r.stores as { status?: string } | null
      return s?.status === 'active'
    })
    .map((r) => {
      const s = r.stores as { id: string; store_code: string; store_name: string; store_type: string; state: string; city: string } | null
      const p = r.products as { id: string; sku: string; name: string; category: string } | null
      const urgency = r.quantity_on_hand === 0
        ? 'critical'
        : r.quantity_on_hand <= Math.floor(r.restock_threshold / 2)
          ? 'high'
          : 'medium'
      return {
        store_id: s?.id,
        store_code: s?.store_code,
        store_name: s?.store_name,
        store_type: s?.store_type,
        state: s?.state,
        city: s?.city,
        sku: p?.sku,
        product_name: p?.name,
        category: p?.category,
        quantity_on_hand: r.quantity_on_hand,
        restock_threshold: r.restock_threshold,
        last_restocked_at: r.last_restocked_at,
        urgency,
      }
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

  return Response.json({
    summary,
    total_skus_needing_restock: items.length,
    stores_affected: Object.keys(byStore).length,
    by_store: byStore,
    items,
  })
}
