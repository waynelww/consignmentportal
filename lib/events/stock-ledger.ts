/**
 * Event stock is separate from Office stock. An event's stock location is
 * filled by "Add stock to event" (ledger row from = NULL) and emptied by POS
 * sales, "Remove stock from event" and closing (to = NULL). Office is never
 * touched: its XCMS numbers are overwritten hourly by the Shopify HQ sync.
 *
 * This file turns the stock_transfers rows of one event location into the
 * per-SKU figures shown on the event page. Older events still have rows from
 * the Office-transfer era ("Event checkout:", "Partial return:",
 * "Event return:"); they are classified the same way.
 */

export interface LedgerRow {
  product_id: string
  quantity: number
  from_location_id: string | null
  to_location_id: string | null
  reason: string | null
}

export interface EventStockLine {
  added: number         // put into the event (Add stock / legacy checkout)
  soldPos: number       // Event POS sales minus voids
  soldOutside: number   // "Sold at event (outside POS)" / "(Shopify)" at close
  removed: number       // "Remove stock from event" / legacy partial return
  returned: number      // zeroed at close / legacy close return
}

export const reasons = {
  added: (event: string) => `Event stock added: ${event}`,
  removed: (event: string) => `Event stock removed: ${event}`,
  closedReturned: (event: string) => `Event closed — returned: ${event}`,
}

const emptyLine = (): EventStockLine => ({ added: 0, soldPos: 0, soldOutside: 0, removed: 0, returned: 0 })

export function summariseEventLedger(rows: LedgerRow[], locationId: string): Record<string, EventStockLine> {
  const out: Record<string, EventStockLine> = {}
  for (const r of rows) {
    const line = (out[r.product_id] ??= emptyLine())
    const reason = r.reason ?? ''
    if (r.to_location_id === locationId) {
      if (reason.startsWith('Event POS void:')) line.soldPos -= r.quantity
      else line.added += r.quantity
    } else if (r.from_location_id === locationId) {
      if (reason.startsWith('Event POS sale:')) line.soldPos += r.quantity
      else if (reason.startsWith('Sold at event')) line.soldOutside += r.quantity
      else if (reason.startsWith('Event closed') || reason.startsWith('Event return:')) line.returned += r.quantity
      else line.removed += r.quantity
    }
  }
  return out
}
