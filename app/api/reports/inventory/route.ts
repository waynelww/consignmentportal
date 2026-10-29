import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cachedAdminJson } from '@/lib/cache'

import { describeCode, embedded } from '@/lib/restock/low-stock'
import { loadLowStockSettings } from '@/lib/restock/low-stock-settings'
export async function GET(_request: NextRequest) {
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

  const lowSettings = await loadLowStockSettings(supabase)
  // Full inventory snapshot across all stores
  const { data: inventory, error } = await supabase
    .from('store_inventory')
    .select(`
      id,
      store_id,
      product_id,
      quantity_on_hand,
      stocked_level,
      plan_level,
      last_restocked_at,
      updated_at,
      products:product_id ( id, sku, name, category, color, selling_price, is_active ),
      stores:store_id ( id, store_code, store_name, city, state, status, pairs_per_code, on_stock_plan )
    `)
    .order('store_id', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const snapshot = (inventory ?? []).map((item) => {
    const store = embedded(item.stores as never) as { pairs_per_code: number; on_stock_plan: boolean } | null
    const stock_status = store ? describeCode(item, store, lowSettings.pct).status : 'in_stock'
    return { ...item, stock_status }
  })

  // Summary stats
  const total_skus = snapshot.length
  const out_of_stock = snapshot.filter((i) => i.stock_status === 'out_of_stock').length
  const low_stock = snapshot.filter((i) => i.stock_status === 'low_stock').length
  const in_stock = snapshot.filter((i) => i.stock_status === 'in_stock').length
  const total_pairs_across_stores = snapshot.reduce((sum, i) => sum + i.quantity_on_hand, 0)

  return cachedAdminJson({
    inventory: snapshot,
    summary: { total_skus, in_stock, low_stock, out_of_stock, total_pairs_across_stores },
  })
}
