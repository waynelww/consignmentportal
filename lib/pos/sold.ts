import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Units sold through the Event POS per product (voided sales excluded),
 * counted in stock units (FREE 6 Patches = 6 patches). `usesPos` is true once
 * the event has any POS sale, voided or not.
 */
export async function posSoldByProduct(db: SupabaseClient, eventId: string): Promise<{ usesPos: boolean; sold: Record<string, number> }> {
  const { data, error } = await db.from('pos_sales')
    .select('voided_at, pos_sale_items(product_id, stock_qty)')
    .eq('event_id', eventId)
  if (error) {
    // Before the POS migration is applied the table does not exist: behave as "no POS".
    return { usesPos: false, sold: {} }
  }
  const sold: Record<string, number> = {}
  for (const s of data ?? []) {
    if (s.voided_at) continue
    for (const i of (s.pos_sale_items ?? []) as { product_id: string; stock_qty: number }[]) {
      sold[i.product_id] = (sold[i.product_id] ?? 0) + i.stock_qty
    }
  }
  return { usesPos: (data ?? []).length > 0, sold }
}
