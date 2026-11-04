import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeSku } from '@/lib/stock/hq-availability'

// Reads the "Office (HQ)" Shopify location ONLY and writes each product's
// available quantity onto products.hq_available_qty (matched by SKU).
// Nothing from any other location (including the Flexship warehouse) is read.
// Old shopify_inventory_qty columns are no longer written (kept untouched).
//
// Products whose SKU has no inventory record at HQ are written as 0 and
// counted in `not_at_hq`, so a SKU mismatch shows up in the result.

export const OFFICE_HQ_LOCATION_ID = 'gid://shopify/Location/97815986484'
export const OFFICE_HQ_LOCATION_NAME = 'Office (HQ)'

const SHOPIFY_API_VERSION = '2024-10'
const PAGE_SIZE = 250
const MAX_PAGES = 40 // safety cap: 10,000 inventory levels
const WRITE_CHUNK = 25

export interface SyncResult {
  success: true
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

/**
 * Refreshes products.hq_available_qty and hq_synced_at from Office (HQ).
 * Used by the nightly cron and the admin "Refresh from Shopify" button.
 * Must finish inside Vercel's 60s limit: two or three GraphQL pages, then
 * parallel writes in chunks.
 */
export async function syncShopifyInventory(): Promise<SyncResult | SyncError> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    return { success: false, status: 500, error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars' }
  }

  let fetched: { skuToQty: Map<string, number>; levels: number }
  try {
    fetched = await fetchHqInventory(domain, token)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Shopify inventory'
    return { success: false, status: 502, error: `Shopify fetch failed: ${message}` }
  }
  const { skuToQty, levels } = fetched

  const adminClient = createAdminClient()
  const { data: products, error: prodErr } = await adminClient.from('products').select('id, sku')
  if (prodErr || !products) {
    return { success: false, status: 500, error: `Failed to fetch products: ${prodErr?.message ?? 'unknown'}` }
  }

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
  let failed = 0
  for (let i = 0; i < toWrite.length; i += WRITE_CHUNK) {
    const results = await Promise.all(
      toWrite.slice(i, i + WRITE_CHUNK).map((u) =>
        adminClient
          .from('products')
          .update({ hq_available_qty: u.qty, hq_synced_at: syncedAt })
          .eq('id', u.id),
      ),
    )
    for (const r of results) {
      if (r.error) failed++
      else updated++
    }
  }

  await adminClient
    .from('settings')
    .upsert({ key: 'shopify_hq_last_synced', value: syncedAt, updated_at: syncedAt }, { onConflict: 'key' })

  if (failed > 0) {
    return { success: false, status: 500, error: `${failed} of ${toWrite.length} product updates failed; run the refresh again` }
  }

  return {
    success: true,
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
  }
}
