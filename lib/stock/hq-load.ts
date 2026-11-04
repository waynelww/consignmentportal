import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeSku, type HqStockMap } from '@/lib/stock/hq-availability'

// Reads the Office (HQ) numbers already stored on products (browser or server
// client). Pages through the table so the 1000-row default cap never cuts it short.
export async function loadHqStock(db: SupabaseClient): Promise<{ map: HqStockMap; idBySku: Map<string, string>; syncedAt: string | null }> {
  const map: HqStockMap = new Map()
  const idBySku = new Map<string, string>()
  let syncedAt: string | null = null
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('products')
      .select('id, sku, hq_available_qty, hq_synced_at')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: string; sku: string | null; hq_available_qty: number | null; hq_synced_at: string | null }[]
    for (const r of rows) {
      const key = normalizeSku(r.sku)
      if (!key) continue
      map.set(key, r.hq_available_qty)
      idBySku.set(key, r.id)
      if (r.hq_synced_at && (!syncedAt || r.hq_synced_at > syncedAt)) syncedAt = r.hq_synced_at
    }
    if (rows.length < PAGE) break
  }
  return { map, idBySku, syncedAt }
}
