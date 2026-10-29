// Pairs sold per store since a date. Lives apart from last-sale.ts because it
// pages through rows, and it is safe to import from client pages.

import type { SupabaseClient } from '@supabase/supabase-js'

// PostgREST returns at most 1,000 rows per request unless the client pages.
const PAGE_SIZE = 1000

/**
 * Sums sales.quantity per store for sales dated on or after `fromDate`
 * (YYYY-MM-DD, Malaysia day). Reads every page: a single request would be
 * cut off at 1,000 rows and quietly under-count busy stores.
 */
export async function fetchPairsSinceByStore(
  db: SupabaseClient,
  storeIds: string[],
  fromDate: string
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {}
  if (storeIds.length === 0) return totals

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('sales')
      .select('id, store_id, quantity')
      .in('store_id', storeIds)
      .gte('sale_date', fromDate)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)

    for (const row of data ?? []) {
      totals[row.store_id] = (totals[row.store_id] ?? 0) + row.quantity
    }
    if (!data || data.length < PAGE_SIZE) break
  }
  return totals
}
