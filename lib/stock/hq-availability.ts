// Office (HQ) availability rules. Pure: no database or Shopify calls, so
// the same rule runs on the server and in the browser.
//
// Numbers come from the Shopify "Office (HQ)" location only (see
// lib/shopify/sync-inventory.ts), stored on products.hq_available_qty.
//
//   'out'   → HQ has 0            (red   "Out at HQ")
//   'short' → HQ has fewer than needed (amber "Only X at HQ")
//   'ok'    → enough at HQ, or HQ has not been synced yet (no warning)

export type HqStatus = 'out' | 'short' | 'ok'

export function hqAvailability(hqQty: number | null | undefined, needed: number): HqStatus {
  if (hqQty == null) return 'ok' // never synced: do not raise false alarms
  if (hqQty <= 0) return 'out'
  if (hqQty < needed) return 'short'
  return 'ok'
}

/** SKU matching used everywhere HQ numbers are joined to products. */
export function normalizeSku(sku: string | null | undefined): string {
  return (sku ?? '').trim().toUpperCase()
}

/** SKU → HQ quantity (null = never synced). */
export type HqStockMap = Map<string, number | null>

export function hqAvailabilityForSku(
  sku: string | null | undefined,
  needed: number,
  map: HqStockMap,
): { status: HqStatus; hqQty: number | null } {
  const key = normalizeSku(sku)
  const hqQty = key && map.has(key) ? map.get(key) ?? null : null
  return { status: hqAvailability(hqQty, needed), hqQty }
}
