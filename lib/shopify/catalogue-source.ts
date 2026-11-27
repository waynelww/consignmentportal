// Which Shopify product a SKU takes its name and photo from.
// Pure: no database or Shopify calls. Used by the daily image sync
// (lib/shopify/sync-variant-images.ts) and the hourly / nightly / Refresh
// catalogue sync (lib/shopify/catalogue-match.ts), pinned by
// scripts/test-catalogue-source.ts.
//
// Several Shopify products reuse our regular SKUs (A/C/H/V/K numbers):
// "Plain Series - …", "… (Offline)", colour bundles, and collab products
// such as "Xocks x Luwis — Socks" and "We Want Jam x Xocks (Adults / Kids)".
// Rules:
//  1. Collab products (title contains "Luwis", "We Want Jam" or "WWJ") are
//     never used for a name or photo, and XCMS never creates products from them.
//  2. If any ACTIVE product has the SKU, ARCHIVED and DRAFT products are not used.
//  3. Order: title starting "Plain Series" (not a "Trial Bundle"), then title
//     ending "(Offline)", then any other product. Ties: a title without
//     "(Offline)" first, then title A–Z, then variant id, so the pick is stable.
//  4. Photo: the variant's own image first, then the product's featured image,
//     from the first product in that order that has either.
// Only names and photos follow these rules. SKU links and stock are unchanged.

export interface SourceVariant {
  id: string // ProductVariant GID
  sku: string | null
  title: string // variant title, e.g. "Pink Ponk"
  imageUrl: string | null // variant image
  productTitle: string // e.g. "Plain Series - For Kids (4YO to 12 YO)"
  productImageUrl: string | null // product featured image (fallback)
  /** Shopify product status: ACTIVE, ARCHIVED or DRAFT. Missing is treated as ACTIVE. */
  productStatus?: string | null
}

/** "Xocks x Luwis — Socks", "We Want Jam x Xocks (Kids)", "WWJ …": never a name or photo source. */
export function isCollabProductTitle(title: string | null | undefined): boolean {
  return /luwis|we\s*want\s*jam|\bwwj\b/i.test(title ?? '')
}

export function isActiveProduct(v: Pick<SourceVariant, 'productStatus'>): boolean {
  return (v.productStatus ?? 'ACTIVE').toUpperCase() === 'ACTIVE'
}

/** 0 = Plain Series (not Trial Bundle), 1 = "(Offline)", 2 = anything else. */
export function sourceTier(productTitle: string): 0 | 1 | 2 {
  const t = productTitle.trim()
  if (/^plain series/i.test(t) && !/trial bundle/i.test(t)) return 0
  if (/\(offline\)$/i.test(t)) return 1
  return 2
}

/**
 * The variants a name or photo may come from, best first. Collab products are
 * dropped; inactive products are dropped when an active one is left.
 */
export function rankSources<V extends SourceVariant>(variants: V[]): V[] {
  const usable = variants.filter((v) => !isCollabProductTitle(v.productTitle))
  const active = usable.filter(isActiveProduct)
  const pool = active.length > 0 ? active : usable
  const offline = (v: V) => (/\(offline\)$/i.test(v.productTitle.trim()) ? 1 : 0)
  return [...pool].sort((a, b) =>
    sourceTier(a.productTitle) - sourceTier(b.productTitle) ||
    offline(a) - offline(b) ||
    a.productTitle.localeCompare(b.productTitle) ||
    a.id.localeCompare(b.id),
  )
}

/** The photo for a SKU from its variants, or null when no usable product has one. */
export function pickPhoto<V extends SourceVariant>(variants: V[]): { url: string; variant: V } | null {
  for (const v of rankSources(variants)) {
    const url = v.imageUrl ?? v.productImageUrl
    if (url) return { url, variant: v }
  }
  return null
}

/** "<product title> - <variant title>" from the best source, e.g.
 *  "Plain Series - For Kids (4YO to 12 YO) - Pink Ponk". Null when none is usable. */
export function pickName<V extends SourceVariant>(variants: V[]): string | null {
  const best = rankSources(variants)[0]
  return best ? `${best.productTitle} - ${best.title}` : null
}
