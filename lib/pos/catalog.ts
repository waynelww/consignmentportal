// Event POS catalogue rules — pure, shared by the POS API and the phone UI.
// Products come from XCMS `products`; stock comes ONLY from the event's own
// XCMS stock location (never Shopify).

/** The series is the part of the product name before the first " - ". */
export function seriesOf(name: string): string {
  return (name.split(' - ')[0] ?? name).trim()
}

/** Special Patches Series is consignment-only: never sold on the event POS. */
export function isExcludedFromPos(name: string): boolean {
  return /^special patches series$/i.test(seriesOf(name))
}

/** A patch (sold per piece, RM4 etc.). "Any Patch Socks" / "Patches Socks (…)" are socks, not patches. */
export function isPatch(name: string): boolean {
  const s = seriesOf(name)
  return /\bpatch(es)?\b/i.test(s) && !/socks?/i.test(s)
}

/** Add-ons never count as pairs: patches, tote bags, boxes. */
export function isAddon(name: string): boolean {
  const s = seriesOf(name)
  return isPatch(name) || /tote bag|\bbox\b/i.test(s)
}

/** The real "FREE n Patches" products are replaced by the POS's own virtual items below. */
export function isHiddenFreePatchProduct(name: string): boolean {
  return /^free(\s+\d+)?\s+patches$/i.test(seriesOf(name))
}

/** The RM4 per-piece patch product ("(RM4) Per Patches", SKU "Patches"). */
export const PATCH_SKU = 'PATCHES'

/**
 * Patches have no stock at events (too many to count): the RM4 patch and the
 * FREE 6 / 10 Patches tiles are always on the POS, never greyed out, never
 * stock-checked and never deducted from any location (pos_record_sale /
 * pos_void_sale skip them, migration 20261128_event_pos_patches_no_stock.sql).
 * Sales are still recorded in pos_sale_items (stock_qty = patches given).
 * Patches are never added as event stock either.
 */
export function isPatchSku(sku: string | null | undefined): boolean {
  return (sku ?? '').trim().toUpperCase() === PATCH_SKU
}

export interface VirtualItem { key: string; label: string; patches: number }
export const VIRTUAL_ITEMS: VirtualItem[] = [
  { key: 'free6patches', label: 'FREE 6 Patches', patches: 6 },
  { key: 'free10patches', label: 'FREE 10 Patches', patches: 10 },
]

export type PosChip = 'all' | 'combos' | 'ankle' | 'half' | 'crew' | 'no_show' | 'kids' | 'design' | 'addons'
export const POS_CHIPS: { key: PosChip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'combos', label: 'Combos' },
  { key: 'ankle', label: 'Ankle' },
  { key: 'half', label: 'Half' },
  { key: 'crew', label: 'Crew' },
  { key: 'no_show', label: 'No Show' },
  { key: 'kids', label: 'Kids' },
  { key: 'design', label: 'Design' },
  { key: 'addons', label: 'Add-ons' },
]

/** One tile on the POS. id = product id, or the virtual item key. */
export interface PosProduct {
  id: string
  product_id: string // the stock product (the patch product for virtual items)
  sku: string
  name: string
  price: number
  image_url: string | null
  barcode: string | null
  category: string
  is_pair: boolean
  is_patch: boolean
  design: boolean
  stock_per_unit: number // units of product_id per item sold (6 for FREE 6 Patches)
  left: number // event stock of product_id (shared by items on the same product); 0 for patches
  unlimited: boolean // patches: no stock, no "N left", never sold out
}

export function chipMatches(p: PosProduct, chip: PosChip): boolean {
  switch (chip) {
    case 'all': return true
    case 'combos': return false
    case 'addons': return !p.is_pair
    case 'design': return p.design && p.is_pair
    default: return p.is_pair && p.category === chip
  }
}

export interface RawProduct {
  id: string; sku: string; name: string; selling_price: number | string
  image_url: string | null; barcode: string | null; category: string | null
}

/**
 * Build the POS tiles from products + their quantity at the event location.
 * `patchProduct` (the active RM4 patch product) is always added with its two
 * FREE tiles, whatever the event stock; any patch row in `rows` is ignored.
 */
export function buildPosProducts(rows: { product: RawProduct; qty: number }[], patchProduct?: RawProduct | null): PosProduct[] {
  const out: PosProduct[] = []
  const patch = patchProduct ?? null
  const all = patch ? [...rows.filter((r) => !isPatchSku(r.product.sku)), { product: patch, qty: 0 }] : rows.filter((r) => !isPatchSku(r.product.sku))
  for (const { product: p, qty } of all) {
    if (isExcludedFromPos(p.name) || isHiddenFreePatchProduct(p.name)) continue
    const unlimited = isPatchSku(p.sku)
    out.push({
      id: p.id,
      product_id: p.id,
      sku: p.sku,
      name: p.name,
      price: Number(p.selling_price) || 0,
      image_url: p.image_url,
      barcode: p.barcode,
      category: p.category ?? '',
      is_pair: !isAddon(p.name),
      is_patch: isPatch(p.name),
      design: p.category === 'design',
      stock_per_unit: 1,
      left: unlimited ? 0 : qty,
      unlimited,
    })
  }
  if (patch) {
    for (const v of VIRTUAL_ITEMS) {
      out.push({
        id: v.key,
        product_id: patch.id,
        sku: patch.sku,
        name: v.label,
        price: 0,
        image_url: patch.image_url,
        barcode: null,
        category: '',
        is_pair: false,
        is_patch: false, // free patches never count toward "Free 1 Set Patch"
        design: false,
        stock_per_unit: v.patches,
        left: 0,
        unlimited: true,
      })
    }
  }
  return out.sort((a, b) => Number(b.is_pair) - Number(a.is_pair) || a.name.localeCompare(b.name))
}

/** How many more of `item` can go in the cart, given what's already in it (shared stock counted). */
export function remainingFor(item: PosProduct, cart: Record<string, number>, all: PosProduct[]): number {
  if (item.unlimited) return Infinity
  let used = 0
  for (const p of all) {
    if (p.product_id === item.product_id) used += (cart[p.id] ?? 0) * p.stock_per_unit
  }
  return Math.max(0, Math.floor((item.left - used) / item.stock_per_unit))
}
