import { createAdminClient } from '@/lib/supabase/admin'

// Shared sync logic used by both the manual admin endpoint and the daily cron.

interface SyncResult {
  success: true
  shopify_variants_fetched: number
  products_in_db: number
  updated: number
  unchanged: number
  not_found_in_shopify: number
  not_found_skus: string[]
}

interface SyncError {
  success: false
  error: string
  status: number
}

const SHOPIFY_API_VERSION = '2024-10'

interface VariantNode {
  sku: string | null
  image: { url: string } | null
  product: { featuredImage: { url: string } | null } | null
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

async function fetchAllVariants(domain: string, token: string): Promise<Map<string, string>> {
  const skuToImage = new Map<string, string>()
  let after: string | null = null

  for (let page = 0; page < 50; page++) {
    const query = `
      query AllVariants($first: Int!, $after: String) {
        productVariants(first: $first, after: $after) {
          edges {
            cursor
            node {
              sku
              image { url }
              product { featuredImage { url } }
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
      const url = edge.node.image?.url ?? edge.node.product?.featuredImage?.url ?? null
      if (url) skuToImage.set(sku, url)
    }

    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }

  return skuToImage
}

export async function syncShopifyVariantImages(): Promise<SyncResult | SyncError> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN

  if (!domain || !token) {
    return {
      success: false,
      status: 500,
      error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars',
    }
  }

  let skuToImage: Map<string, string>
  try {
    skuToImage = await fetchAllVariants(domain, token)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Shopify variants'
    return { success: false, status: 502, error: `Shopify fetch failed: ${message}` }
  }

  if (skuToImage.size === 0) {
    return { success: false, status: 404, error: 'No variants returned from Shopify' }
  }

  const adminClient = createAdminClient()
  const { data: products, error: prodErr } = await adminClient
    .from('products')
    .select('id, sku, image_url')

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

  for (const p of products) {
    const sku = (p.sku ?? '').trim().toUpperCase()
    const newUrl = skuToImage.get(sku)
    if (!newUrl) {
      notFound++
      notFoundSkus.push(p.sku)
      continue
    }
    if (newUrl === p.image_url) {
      unchanged++
      continue
    }
    const { error: updErr } = await adminClient
      .from('products')
      .update({ image_url: newUrl, updated_at: new Date().toISOString() })
      .eq('id', p.id)
    if (!updErr) updated++
  }

  return {
    success: true,
    shopify_variants_fetched: skuToImage.size,
    products_in_db: products.length,
    updated,
    unchanged,
    not_found_in_shopify: notFound,
    not_found_skus: notFoundSkus.slice(0, 20),
  }
}
