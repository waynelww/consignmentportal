import type { SupabaseClient } from '@supabase/supabase-js'
import { isPatchSku } from './catalog'

// Patches given out through the Event POS (voided sales excluded), so the team
// knows how many to bring next time. Patches have no event stock; this comes
// only from pos_sale_items lines on the patch product (SKU "Patches"):
//   * sold  = RM4 patch lines (unit_price > 0), in patches (= qty)
//   * free  = FREE 6 / FREE 10 Patches lines (unit_price 0), in patches (stock_qty: 6 / 10 each)
// "Free 1 Set Patch" (RM8 off) is a discount on RM4 patch lines, so those
// patches count under sold.

export interface PatchDay { day: string; sold: number; free: number }
export interface PatchSummary { days: PatchDay[]; sold: number; free: number }

interface SaleRow {
  event_day: string
  voided_at: string | null
  pos_sale_items: { sku: string; qty: number; stock_qty: number; unit_price: number | string }[] | null
}

/** Pure: per-day and whole-event patch counts from POS sales. */
export function summarisePatches(sales: SaleRow[]): PatchSummary {
  const byDay = new Map<string, PatchDay>()
  for (const s of sales) {
    if (s.voided_at) continue
    for (const i of s.pos_sale_items ?? []) {
      if (!isPatchSku(i.sku)) continue
      const d = byDay.get(s.event_day) ?? { day: s.event_day, sold: 0, free: 0 }
      if (Number(i.unit_price) > 0) d.sold += i.stock_qty
      else d.free += i.stock_qty
      byDay.set(s.event_day, d)
    }
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  return {
    days,
    sold: days.reduce((n, d) => n + d.sold, 0),
    free: days.reduce((n, d) => n + d.free, 0),
  }
}

export async function patchesGiven(db: SupabaseClient, eventId: string): Promise<PatchSummary> {
  const { data, error } = await db.from('pos_sales')
    .select('event_day, voided_at, pos_sale_items(sku, qty, stock_qty, unit_price)')
    .eq('event_id', eventId)
  // Before the POS migration the table does not exist: no patches.
  if (error) return { days: [], sold: 0, free: 0 }
  return summarisePatches((data ?? []) as unknown as SaleRow[])
}
