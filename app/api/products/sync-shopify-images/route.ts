import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// One-shot backfill: pulls every product variant from Shopify and updates
// products.image_url with the per-variant image (fallback to product featured image).
//
// Required env vars (set in Vercel):
//   SHOPIFY_STORE_DOMAIN   e.g. xocks.co or xocks.myshopify.com
//   SHOPIFY_ADMIN_TOKEN    Admin API access token (shpat_...)
//
// Call: POST /api/products/sync-shopify-images   (auth: super_admin or ops_manager)

const SHOPIFY_API_VERSION = '2024-10'

interface VariantNode {
  sku: string | null
  image: { url: string } | null
  product: { featuredImage: { url: string } | null } | null
}

interface VariantEdge {
  cursor: string
  node: VariantNode
}

interface ShopifyResponse {
  data?: {
    productVariants: {
      edges: VariantEdge[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  }
  errors?: { message: string }[]
}

async function fetchAllVariants(domain: string, token: string): Promise<Map<string, string>> {
  const skuToImage = new Map<string, string>()
  let after: string | null = null

  for (let page = 0; page < 50; page++) { // safety cap at 2500 variants
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
      body: JSON.stringify({ query, variables: { first: 50, after } }),
    })

    if (!res.ok) {
      throw new Error(`Shopify API ${res.status}: ${await res.text()}`)
    }

    const json = (await res.json()) as ShopifyResponse
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`)
    }

    const conn = json.data?.productVariants
    if (!conn) break

    for (const edge of conn.edges) {
      const sku = (edge.node.sku ?? '').trim().toUpperCase()
      if (!sku) continue
      // Prefer per-variant image; fall back to product featured image
      const url = edge.node.image?.url ?? edge.node.product?.featuredImage?.url ?? null
      if (url) skuToImage.set(sku, url)
    }

    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }

  return skuToImage
}

export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    return Response.json({
      error: 'Missing env vars',
      details: 'Set SHOPIFY_STORE_DOMAIN (e.g. xocks.myshopify.com) and SHOPIFY_ADMIN_TOKEN in Vercel.',
    }, { status: 500 })
  }

  let skuToImage: Map<string, string>
  try {
    skuToImage = await fetchAllVariants(domain, token)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Shopify variants'
    return Response.json({ error: 'Shopify fetch failed', details: message }, { status: 502 })
  }

  if (skuToImage.size === 0) {
    return Response.json({ error: 'No variants found' }, { status: 404 })
  }

  // Fetch all products from DB
  const adminClient = createAdminClient()
  const { data: products, error: prodErr } = await adminClient
    .from('products')
    .select('id, sku, image_url')

  if (prodErr || !products) {
    return Response.json({ error: 'Failed to fetch products', details: prodErr?.message }, { status: 500 })
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

  return Response.json({
    success: true,
    shopify_variants_fetched: skuToImage.size,
    products_in_db: products.length,
    updated,
    unchanged,
    not_found_in_shopify: notFound,
    not_found_skus: notFoundSkus.slice(0, 20), // cap for response size
  })
}
