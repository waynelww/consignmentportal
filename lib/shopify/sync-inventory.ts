import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeSku } from '@/lib/stock/hq-availability'
import {
  describeCatalogueSync,
  planCatalogueSync,
  type CataloguePlan,
  type ShopifyVariant,
  type XcmsProduct,
} from '@/lib/shopify/catalogue-match'

// One refresh does two things, in this order:
//
// 1. Catalogue (SKU + photo): reads every Shopify product variant and
//    - links unlinked products to their variant (by SKU, else by name, only
//      when exactly one variant matches),
//    - renames a linked product's SKU when Shopify's SKU changed (logged in
//      product_sku_changes), and reports a conflict instead if the new SKU is
//      already used by another product,
//    - copies the variant photo (product featured image as fallback) to image_url.
//    Only sku, image_url and shopify_variant_id are written. See
//    lib/shopify/catalogue-match.ts for the rules.
// 2. Office (HQ) stock: reads the "Office (HQ)" location ONLY and writes each
//    product's available quantity onto products.hq_available_qty, matched by the
//    SKU as it now stands (so a renamed product gets its HQ qty in the same run).
//    Nothing from any other location (including the Flexship warehouse) is read.
//
// Products whose SKU has no inventory record at HQ are written as 0 and
// counted in `not_at_hq`, so a SKU mismatch shows up in the result.

export const OFFICE_HQ_LOCATION_ID = 'gid://shopify/Location/97815986484'
export const OFFICE_HQ_LOCATION_NAME = 'Office (HQ)'

const SHOPIFY_API_VERSION = '2024-10'
const PAGE_SIZE = 250
const MAX_PAGES = 40 // safety cap: 10,000 inventory levels
const WRITE_CHUNK = 25

const CATALOGUE_PAGE_SIZE = 100 // variants are costly to query; 100 keeps each page under Shopify's cost limit
const CATALOGUE_MAX_PAGES = 100 // safety cap: 10,000 variants
const CATALOGUE_TIME_BUDGET_MS = 25_000 // stop paging well before Vercel's 60s ceiling
const NOT_LINKED_IN_RESULT = 50

/** Who asked for the sync: the admin button, or the nightly cron. Recorded in product_sku_changes.source. */
export type SyncSource = 'refresh' | 'nightly'

export interface CatalogueResult {
  variants_fetched: number
  linked: { product_id: string; name: string; sku: string; via: 'sku' | 'name' }[]
  skus_updated: { product_id: string; name: string; old_sku: string; new_sku: string }[]
  sku_conflicts: { product_id: string; name: string; old_sku: string; new_sku: string; conflict_with: string }[]
  photos_updated: number
  not_linked_count: number
  not_linked: { product_id: string; name: string; sku: string; reason: string }[]
  linked_missing_count: number
}

export interface SyncResult {
  success: true
  source: SyncSource
  synced_at: string
  location: string
  levels_fetched: number
  products_in_db: number
  updated: number
  without_sku: number
  not_at_hq: number
  out_at_hq: number
  not_at_hq_skus: string[]
  total_hq_pairs: number
  catalogue: CatalogueResult
  /** Human-readable lines: "SKUs updated: …", "Photos updated: N", conflicts, not linked. */
  summary: string[]
}

export interface SyncError {
  success: false
  error: string
  status: number
}

interface HqLevelNode {
  quantities: { name: string; quantity: number }[]
  item: { sku: string | null } | null
}

interface HqResponse {
  data?: {
    location: {
      id: string
      name: string
      inventoryLevels: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: HqLevelNode[]
      }
    } | null
  }
  errors?: { message: string }[]
}

const HQ_QUERY = `
  query HqInventory($id: ID!, $first: Int!, $after: String) {
    location(id: $id) {
      id
      name
      inventoryLevels(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          quantities(names: ["available"]) { name quantity }
          item { sku }
        }
      }
    }
  }
`

const CATALOGUE_QUERY = `
  query AllVariants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      nodes {
        id
        sku
        title
        image { url }
        product { title featuredImage { url } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

interface CatalogueNode {
  id: string
  sku: string | null
  title: string
  image: { url: string } | null
  product: { title: string; featuredImage: { url: string } | null } | null
}

interface CatalogueResponse {
  data?: {
    productVariants: {
      nodes: CatalogueNode[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    } | null
  }
  errors?: { message: string }[]
}

/** Runs `run` over `items` in parallel chunks, so a large catalogue stays inside the 60s limit. */
async function runChunked<T, R>(items: T[], run: (item: T) => PromiseLike<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += WRITE_CHUNK) {
    out.push(...(await Promise.all(items.slice(i, i + WRITE_CHUNK).map(run))))
  }
  return out
}

/** Every product variant in Shopify, paged 100 at a time. Throws on any Shopify error. */
async function fetchAllVariants(domain: string, token: string): Promise<ShopifyVariant[]> {
  const variants: ShopifyVariant[] = []
  const started = Date.now()
  let after: string | null = null

  for (let page = 0; page < CATALOGUE_MAX_PAGES; page++) {
    if (Date.now() - started > CATALOGUE_TIME_BUDGET_MS) {
      throw new Error(`Shopify product list is slow; stopped after ${variants.length} variants to stay inside the time limit. Try again`)
    }
    const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: CATALOGUE_QUERY, variables: { first: CATALOGUE_PAGE_SIZE, after } }),
    })
    if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`)

    const json = (await res.json()) as CatalogueResponse
    if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)

    const conn = json.data?.productVariants
    if (!conn) throw new Error('Shopify returned no product variants')

    for (const n of conn.nodes) {
      variants.push({
        id: n.id,
        sku: n.sku,
        title: n.title,
        imageUrl: n.image?.url ?? null,
        productTitle: n.product?.title ?? '',
        productImageUrl: n.product?.featuredImage?.url ?? null,
      })
    }

    if (!conn.pageInfo.hasNextPage) return variants
    after = conn.pageInfo.endCursor
  }
  throw new Error(`Shopify product list exceeded ${CATALOGUE_MAX_PAGES * CATALOGUE_PAGE_SIZE} variants; sync stopped`)
}

/** Returns SKU → available quantity at Office (HQ). Throws on any Shopify error. */
async function fetchHqInventory(domain: string, token: string): Promise<{ skuToQty: Map<string, number>; levels: number }> {
  const skuToQty = new Map<string, number>()
  let levels = 0
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: HQ_QUERY,
        variables: { id: OFFICE_HQ_LOCATION_ID, first: PAGE_SIZE, after },
      }),
    })
    if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`)

    const json = (await res.json()) as HqResponse
    if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)

    const location = json.data?.location
    if (!location) throw new Error('Office (HQ) location not found in Shopify')
    // Guard: never sync from a different location than the one we are meant to read.
    if (location.name !== OFFICE_HQ_LOCATION_NAME) {
      throw new Error(`Location ${OFFICE_HQ_LOCATION_ID} is "${location.name}", expected "${OFFICE_HQ_LOCATION_NAME}"`)
    }

    for (const node of location.inventoryLevels.nodes) {
      levels++
      const sku = normalizeSku(node.item?.sku)
      if (!sku) continue
      const qty = node.quantities.find((q) => q.name === 'available')?.quantity ?? 0
      // Same SKU on two inventory items at HQ is rare: keep the larger figure, as before.
      const existing = skuToQty.get(sku)
      skuToQty.set(sku, existing == null ? qty : Math.max(existing, qty))
    }

    if (!location.inventoryLevels.pageInfo.hasNextPage) return { skuToQty, levels }
    after = location.inventoryLevels.pageInfo.endCursor
  }
  throw new Error(`Office (HQ) inventory exceeded ${MAX_PAGES * PAGE_SIZE} levels; sync stopped`)
}

/** A product row as the sync uses it. `sku` is updated in memory when a rename is saved, so the HQ step matches on the new SKU. */
type ProductRow = XcmsProduct

/**
 * Refreshes the Shopify catalogue links, SKUs and photos, then products.hq_available_qty
 * and hq_synced_at from Office (HQ). Used by the nightly cron (source 'nightly') and the
 * admin "Refresh from Shopify" button (source 'refresh'). Must finish inside Vercel's
 * 60s limit: a few paged reads from each of two Shopify queries, then parallel writes
 * in chunks.
 */
export async function syncShopifyInventory(source: SyncSource = 'refresh'): Promise<SyncResult | SyncError> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    return { success: false, status: 500, error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars' }
  }

  const adminClient = createAdminClient()
  const { data: productRows, error: prodErr } = await adminClient
    .from('products')
    .select('id, sku, name, image_url, shopify_variant_id')
  if (prodErr || !productRows) {
    return { success: false, status: 500, error: `Failed to fetch products: ${prodErr?.message ?? 'unknown'}` }
  }
  const products: ProductRow[] = productRows.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    image_url: p.image_url,
    shopify_variant_id: p.shopify_variant_id,
  }))

  // ---- 1. Catalogue: links, SKU renames, photos ---------------------------
  let variants: ShopifyVariant[]
  try {
    variants = await fetchAllVariants(domain, token)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Shopify variants'
    return { success: false, status: 502, error: `Shopify catalogue fetch failed: ${message}` }
  }
  if (variants.length === 0) {
    return { success: false, status: 404, error: 'No product variants returned from Shopify; nothing was changed' }
  }

  const plan: CataloguePlan = planCatalogueSync(products, variants)
  const failures: string[] = []
  const productById = new Map(products.map((p) => [p.id, p]))

  // Link and photo go in one update per product. Linking sets shopify_variant_id,
  // which the unique index protects against a double link.
  const linkByProduct = new Map(plan.links.map((l) => [l.productId, l.variantId]))
  const photoByProduct = new Map(plan.photoUpdates.map((u) => [u.productId, u.newUrl]))
  const rowIds = [...new Set([...linkByProduct.keys(), ...photoByProduct.keys()])]

  const rowResults = await runChunked(rowIds, async (productId) => {
    const patch: { updated_at: string; shopify_variant_id?: string; image_url?: string } = {
      updated_at: new Date().toISOString(),
    }
    const variantId = linkByProduct.get(productId)
    const url = photoByProduct.get(productId)
    if (variantId) patch.shopify_variant_id = variantId
    if (url) patch.image_url = url
    const { error } = await adminClient.from('products').update(patch).eq('id', productId)
    if (error) failures.push(`${productById.get(productId)?.name ?? productId}: ${error.message}`)
    return { productId, ok: !error, linked: !!variantId, photo: !!url }
  })
  const linkedOk = new Set(rowResults.filter((r) => r.ok && r.linked).map((r) => r.productId))
  const appliedLinks = plan.links.filter((l) => linkedOk.has(l.productId))
  const photosUpdated = rowResults.filter((r) => r.ok && r.photo).length

  // SKU renames go through apply_product_sku_change, which writes the history row
  // in the same transaction. A duplicate SKU (23505) is reported, not forced.
  const renameResults = await runChunked(plan.skuChanges, async (c) => {
    const { error } = await adminClient.rpc('apply_product_sku_change', {
      p_product_id: c.productId,
      p_new_sku: c.newSku,
      p_source: source,
    })
    if (error) failures.push(`SKU ${c.oldSku} → ${c.newSku}: ${error.message}`)
    return { change: c, ok: !error }
  })
  const appliedRenames = renameResults.filter((r) => r.ok).map((r) => r.change)
  for (const c of appliedRenames) {
    const product = productById.get(c.productId)
    if (product) product.sku = c.newSku
  }
  const catalogueChanged = appliedLinks.length + photosUpdated + appliedRenames.length > 0

  const catalogueApplied: CataloguePlan = { ...plan, links: appliedLinks, skuChanges: appliedRenames }
  const catalogue: CatalogueResult = {
    variants_fetched: variants.length,
    linked: appliedLinks.map((l) => ({
      product_id: l.productId,
      name: productById.get(l.productId)?.name ?? '',
      sku: productById.get(l.productId)?.sku ?? '',
      via: l.via,
    })),
    skus_updated: appliedRenames.map((c) => ({ product_id: c.productId, name: c.name, old_sku: c.oldSku, new_sku: c.newSku })),
    sku_conflicts: plan.skuConflicts.map((c) => ({
      product_id: c.productId,
      name: c.name,
      old_sku: c.oldSku,
      new_sku: c.newSku,
      conflict_with: c.conflictName,
    })),
    photos_updated: photosUpdated,
    not_linked_count: plan.notLinked.length,
    not_linked: plan.notLinked.slice(0, NOT_LINKED_IN_RESULT).map((n) => ({
      product_id: n.productId,
      name: n.name,
      sku: n.sku,
      reason: n.reason,
    })),
    linked_missing_count: plan.linkedMissing.length,
  }
  const catalogueSummary = describeCatalogueSync(catalogueApplied, photosUpdated)

  // ---- 2. Office (HQ) stock, matched on the SKUs as they now stand --------
  let fetched: { skuToQty: Map<string, number>; levels: number }
  try {
    fetched = await fetchHqInventory(domain, token)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Shopify inventory'
    return {
      success: false,
      status: 502,
      error: `Shopify fetch failed: ${message}${catalogueChanged ? ' (SKU and photo changes were already saved)' : ''}`,
    }
  }
  const { skuToQty, levels } = fetched

  const syncedAt = new Date().toISOString()
  const toWrite: { id: string; qty: number }[] = []
  let withoutSku = 0
  let notAtHq = 0
  let outAtHq = 0
  let totalHqPairs = 0
  const notAtHqSkus: string[] = []

  for (const p of products) {
    const sku = normalizeSku(p.sku)
    if (!sku) { withoutSku++; continue }
    let qty = skuToQty.get(sku)
    if (qty == null) {
      notAtHq++
      if (notAtHqSkus.length < 20) notAtHqSkus.push(p.sku)
      qty = 0
    }
    if (qty === 0) outAtHq++
    totalHqPairs += qty
    toWrite.push({ id: p.id, qty })
  }

  // Every matched product gets hq_synced_at, so the timestamp means "checked
  // against HQ at this time" for the whole catalogue, not only changed rows.
  let updated = 0
  let hqFailed = 0
  const hqResults = await runChunked(toWrite, (u) =>
    adminClient
      .from('products')
      .update({ hq_available_qty: u.qty, hq_synced_at: syncedAt })
      .eq('id', u.id)
      .then(({ error }) => error),
  )
  for (const err of hqResults) {
    if (err) hqFailed++
    else updated++
  }

  await adminClient
    .from('settings')
    .upsert({ key: 'shopify_hq_last_synced', value: syncedAt, updated_at: syncedAt }, { onConflict: 'key' })

  if (failures.length > 0 || hqFailed > 0) {
    const parts: string[] = []
    if (failures.length > 0) parts.push(`${failures.length} catalogue update(s) failed (${failures.slice(0, 3).join('; ')})`)
    if (hqFailed > 0) parts.push(`${hqFailed} of ${toWrite.length} HQ stock updates failed`)
    return { success: false, status: 500, error: `${parts.join('; ')}; run the refresh again` }
  }

  return {
    success: true,
    source,
    synced_at: syncedAt,
    location: OFFICE_HQ_LOCATION_NAME,
    levels_fetched: levels,
    products_in_db: products.length,
    updated,
    without_sku: withoutSku,
    not_at_hq: notAtHq,
    out_at_hq: outAtHq,
    not_at_hq_skus: notAtHqSkus,
    total_hq_pairs: totalHqPairs,
    catalogue,
    summary: catalogueSummary,
  }
}
