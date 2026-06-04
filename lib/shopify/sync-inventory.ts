import { createAdminClient } from '@/lib/supabase/admin'

// Pulls every variant's total inventory quantity from Shopify
// (summed across all Shopify locations) and writes it onto the
// products row by matching on SKU.

interface SyncResult {
  success: true
  shopify_variants_fetched: number
  products_in_db: number
  updated: number
  unchanged: number
  not_found_in_shopify: number
  not_found_skus: string[]
  total_warehouse_pairs: number
}

interface SyncError {
  success: false
  error: string
  status: number
}

const SHOPIFY_API_VERSION = '2024-10'

interface VariantNode {
  sku: string | null
  inventoryQuantity: number | null
}

interface ShopifyResponse {
  data?: {
    productVariants: {
      edges: { cursor: string; node: VariantNode }[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  }
  errors?: { message: string }[]
}

async function fetchAllInventory(domain: string, token: string): Promise<Map<string, number>> {
  const skuToQty = new Map<string, number>()
  let after: string | null = null

  for (let page = 0; page < 50; page++) { // safety cap ~5000 variants
    const query = `
      query Inventory($first: Int!, $after: String) {
        productVariants(first: $first, after: $after) {
          edges {
            cursor
            node {
              sku
              inventoryQuantity
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `

    const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { first: 100, after } }),
    })

    if (!res.ok) {
      throw new Error(`Shopify API ${res.status}: ${await res.text()}`)
    }

    const json = (await res.json()) as ShopifyResponse
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)
    }

    const conn = json.data?.productVariants
    if (!conn) break

    for (const edge of conn.edges) {
      const sku = (edge.node.sku ?? '').trim().toUpperCase()
      if (!sku) continue
      const qty = edge.node.inventoryQuantity ?? 0
      // If the same SKU appears in multiple products (rare but happens with
      // bundles), keep the max — we want a realistic "could allocate this many"
      const existing = skuToQty.get(sku)
      skuToQty.set(sku, existing == null ? qty : Math.max(existing, qty))
    }

    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }

  return skuToQty
}

export async function syncShopifyInventory(): Promise<SyncResult | SyncError> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN

  if (!domain || !token) {
    return {
      success: false,
      status: 500,
      error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars',
    }
  }

  let skuToQty: Map<string, number>
  try {
    skuToQty = await fetchAllInventory(domain, token)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Shopify inventory'
    return { success: false, status: 502, error: `Shopify fetch failed: ${message}` }
  }

  if (skuToQty.size === 0) {
    return { success: false, status: 404, error: 'No variants returned from Shopify' }
  }

  const adminClient = createAdminClient()
  const { data: products, error: prodErr } = await adminClient
    .from('products')
    .select('id, sku, shopify_inventory_qty')

  if (prodErr || !products) {
    return {
      success: false,
      status: 500,
      error: `Failed to fetch products: ${prodErr?.message ?? 'unknown'}`,
    }
  }

  let updated = 0
  let unchanged = 0
  let notFound = 0
  const notFoundSkus: string[] = []
  let totalWarehousePairs = 0
  const syncTime = new Date().toISOString()

  for (const p of products) {
    const sku = (p.sku ?? '').trim().toUpperCase()
    const newQty = skuToQty.get(sku)
    if (newQty == null) {
      notFound++
      notFoundSkus.push(p.sku)
      continue
    }
    totalWarehousePairs += newQty
    if (newQty === p.shopify_inventory_qty) {
      // Still update timestamp so we know it was checked
      await adminClient
        .from('products')
        .update({ shopify_inventory_synced_at: syncTime })
        .eq('id', p.id)
      unchanged++
      continue
    }
    const { error: updErr } = await adminClient
      .from('products')
      .update({
        shopify_inventory_qty: newQty,
        shopify_inventory_synced_at: syncTime,
        updated_at: syncTime,
      })
      .eq('id', p.id)
    if (!updErr) updated++
  }

  return {
    success: true,
    shopify_variants_fetched: skuToQty.size,
    products_in_db: products.length,
    updated,
    unchanged,
    not_found_in_shopify: notFound,
    not_found_skus: notFoundSkus.slice(0, 20),
    total_warehouse_pairs: totalWarehousePairs,
  }
}
