// Shopify catalogue matching rules: which XCMS product links to which Shopify
// variant, when its SKU follows Shopify, and which photo it shows.
// Pure: no database or Shopify calls, so the same rules are pinned by
// scripts/test-catalogue-match.ts and the sync (lib/shopify/sync-inventory.ts)
// only does the reads and writes.
//
// Only SKU and image_url are ever changed here. Name, price, barcode and
// is_active are never touched.

import { normalizeSku } from '../stock/hq-availability'

export interface XcmsProduct {
  id: string
  sku: string
  name: string
  image_url: string | null
  shopify_variant_id: string | null
}

export interface ShopifyVariant {
  id: string // ProductVariant GID
  sku: string | null
  title: string // variant title, e.g. "White Kuih"
  imageUrl: string | null // variant image
  productTitle: string // e.g. "Special Patches Series"
  productImageUrl: string | null // product featured image (fallback)
}

export interface LinkPlan {
  productId: string
  variantId: string
  via: 'sku' | 'name'
}

export interface SkuChangePlan {
  productId: string
  name: string
  oldSku: string // as stored in XCMS
  newSku: string // normalized (trimmed, uppercase) Shopify SKU
}

export interface SkuConflictPlan {
  productId: string
  name: string
  oldSku: string
  newSku: string
  conflictProductId: string
  conflictName: string
}

export interface PhotoPlan {
  productId: string
  oldUrl: string | null
  newUrl: string
}

export interface NotLinkedPlan {
  productId: string
  name: string
  sku: string
  reason: string
}

export interface LinkedMissingPlan {
  productId: string
  name: string
  sku: string
  variantId: string
}

export interface CataloguePlan {
  links: LinkPlan[]
  skuChanges: SkuChangePlan[]
  skuConflicts: SkuConflictPlan[]
  photoUpdates: PhotoPlan[]
  notLinked: NotLinkedPlan[]
  linkedMissing: LinkedMissingPlan[]
}

/** Name for matching: whitespace collapsed, trimmed, case-insensitive. */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The XCMS name a Shopify variant corresponds to: "<product title> - <variant title>". */
export function shopifyVariantName(v: Pick<ShopifyVariant, 'productTitle' | 'title'>): string {
  return `${v.productTitle} - ${v.title}`
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Works out every catalogue change for one refresh.
 *
 * Linking (products with no shopify_variant_id yet):
 *  a) SKU match, only when exactly one Shopify variant has that SKU
 *     (trimmed, case-insensitive). Several variants with the same SKU → not linked.
 *  b) Otherwise name match, only when exactly one variant's
 *     "<product title> - <variant title>" equals the XCMS name (case-insensitive).
 *  A variant already linked to another product is never linked again.
 *
 * Then, for every linked product (old and new links):
 *  - SKU follows Shopify when the variant's SKU differs. If the new SKU is
 *    already used by another XCMS product, nothing changes and it is reported
 *    as a conflict.
 *  - Photo: the variant image, falling back to the product's featured image,
 *    when it differs from image_url. A missing Shopify image never clears one.
 */
export function planCatalogueSync(products: XcmsProduct[], variants: ShopifyVariant[]): CataloguePlan {
  const plan: CataloguePlan = {
    links: [],
    skuChanges: [],
    skuConflicts: [],
    photoUpdates: [],
    notLinked: [],
    linkedMissing: [],
  }

  const productById = new Map(products.map((p) => [p.id, p]))
  const variantById = new Map(variants.map((v) => [v.id, v]))
  const variantsBySku = new Map<string, ShopifyVariant[]>()
  const variantsByName = new Map<string, ShopifyVariant[]>()
  for (const v of variants) {
    const sku = normalizeSku(v.sku)
    if (sku) push(variantsBySku, sku, v)
    push(variantsByName, normalizeName(shopifyVariantName(v)), v)
  }

  // variantId → productId that owns it (existing links first, then new ones)
  const claimed = new Map<string, string>()
  // productId → variantId (existing links first, then new ones)
  const linkOf = new Map<string, string>()
  for (const p of products) {
    if (p.shopify_variant_id) {
      claimed.set(p.shopify_variant_id, p.id)
      linkOf.set(p.id, p.shopify_variant_id)
    }
  }
  // normalized SKU → productId, kept current as renames are planned
  const skuOwner = new Map<string, string>()
  for (const p of products) {
    const sku = normalizeSku(p.sku)
    if (sku) skuOwner.set(sku, p.id)
  }

  // Deterministic order for the plan and the result lines.
  const sorted = [...products].sort((a, b) => normalizeSku(a.sku).localeCompare(normalizeSku(b.sku)) || a.id.localeCompare(b.id))

  const tryLink = (p: XcmsProduct, v: ShopifyVariant, via: 'sku' | 'name') => {
    const owner = claimed.get(v.id)
    if (owner && owner !== p.id) {
      plan.notLinked.push({
        productId: p.id,
        name: p.name,
        sku: p.sku,
        reason: `Shopify variant is already linked to ${productById.get(owner)?.name ?? 'another product'}`,
      })
      return
    }
    claimed.set(v.id, p.id)
    linkOf.set(p.id, v.id)
    plan.links.push({ productId: p.id, variantId: v.id, via })
  }

  // ---- Linking -----------------------------------------------------------
  for (const p of sorted) {
    if (p.shopify_variant_id) continue
    const sku = normalizeSku(p.sku)
    const bySku = sku ? variantsBySku.get(sku) ?? [] : []
    if (bySku.length > 1) {
      plan.notLinked.push({
        productId: p.id,
        name: p.name,
        sku: p.sku,
        reason: `SKU is shared by ${bySku.length} Shopify variants, so it is not linked by ID`,
      })
      continue
    }
    if (bySku.length === 1) {
      tryLink(p, bySku[0], 'sku')
      continue
    }
    const byName = variantsByName.get(normalizeName(p.name)) ?? []
    if (byName.length === 1) {
      tryLink(p, byName[0], 'name')
      continue
    }
    plan.notLinked.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      reason: byName.length > 1
        ? `name matches ${byName.length} Shopify variants`
        : 'not found in Shopify by SKU or name',
    })
  }

  // ---- SKU and photo for every linked product -----------------------------
  for (const p of sorted) {
    const variantId = linkOf.get(p.id)
    if (!variantId) continue
    const v = variantById.get(variantId)
    if (!v) {
      plan.linkedMissing.push({ productId: p.id, name: p.name, sku: p.sku, variantId })
      continue
    }

    const newSku = normalizeSku(v.sku)
    const oldSku = normalizeSku(p.sku)
    if (newSku && newSku !== oldSku) {
      const owner = skuOwner.get(newSku)
      if (owner && owner !== p.id) {
        plan.skuConflicts.push({
          productId: p.id,
          name: p.name,
          oldSku: p.sku,
          newSku,
          conflictProductId: owner,
          conflictName: productById.get(owner)?.name ?? '',
        })
      } else {
        plan.skuChanges.push({ productId: p.id, name: p.name, oldSku: p.sku, newSku })
        if (oldSku) skuOwner.delete(oldSku)
        skuOwner.set(newSku, p.id)
      }
    }

    const newUrl = v.imageUrl ?? v.productImageUrl
    if (newUrl && newUrl !== p.image_url) {
      plan.photoUpdates.push({ productId: p.id, oldUrl: p.image_url, newUrl })
    }
  }

  return plan
}

/**
 * Lines for the Refresh result and the nightly log, e.g.
 *   "SKUs updated: WHITEKUIH → WHITEKUIHC26, …"
 *   "Photos updated: 3"
 * Conflicts and unlinked products follow. Pure, so the browser can use it too.
 */
export function describeCatalogueSync(plan: CataloguePlan, photosUpdated: number, notLinkedShown = 20): string[] {
  const lines: string[] = []
  lines.push(
    plan.skuChanges.length
      ? `SKUs updated: ${plan.skuChanges.map((c) => `${c.oldSku} → ${c.newSku}`).join(', ')}`
      : 'SKUs updated: none',
  )
  lines.push(`Photos updated: ${photosUpdated}`)
  if (plan.links.length) lines.push(`Newly linked to Shopify: ${plan.links.length}`)
  for (const c of plan.skuConflicts) {
    lines.push(`Conflict: ${c.name} stays ${c.oldSku}; ${c.newSku} is already used by ${c.conflictName || 'another product'}`)
  }
  if (plan.notLinked.length) {
    lines.push(`Not linked: ${plan.notLinked.length}`)
    for (const n of plan.notLinked.slice(0, notLinkedShown)) {
      lines.push(`  ${n.name} (${n.sku}): ${n.reason}`)
    }
    if (plan.notLinked.length > notLinkedShown) lines.push(`  …and ${plan.notLinked.length - notLinkedShown} more`)
  }
  if (plan.linkedMissing.length) {
    lines.push(`Linked but variant no longer in Shopify: ${plan.linkedMissing.length} (left as they are)`)
  }
  return lines
}
