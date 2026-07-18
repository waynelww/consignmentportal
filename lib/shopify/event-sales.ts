const SHOPIFY_API_VERSION = '2024-10'

interface OrderNode {
  id: string
  createdAt: string
  physicalLocation: { id: string } | null
  lineItems: { edges: { node: { sku: string | null; quantity: number } }[] }
}

interface OrdersResponse {
  data?: {
    orders: {
      edges: { cursor: string; node: OrderNode }[]
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
    }
  }
  errors?: { message: string }[]
}

/**
 * Sums units sold per SKU at a given Shopify location within a date range,
 * by paginating orders created in that window and filtering to the ones
 * placed at that physical location (POS location, e.g. an event booth).
 *
 * Best-effort: Shopify's `Order.physicalLocation` field availability can
 * vary by API version/plan. Throws on failure — callers should catch and
 * fall back to manual entry rather than block the close-event flow.
 */
export async function fetchUnitsSoldAtLocation(params: {
  locationId: string
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD (inclusive)
}): Promise<Map<string, number>> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) throw new Error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars')

  const skuToQty = new Map<string, number>()
  let after: string | null = null
  const searchQuery = `created_at:>='${params.startDate}' AND created_at:<='${params.endDate}T23:59:59Z'`

  for (let page = 0; page < 50; page++) { // safety cap
    const query = `
      query EventOrders($first: Int!, $after: String, $query: String!) {
        orders(first: $first, after: $after, query: $query) {
          edges {
            cursor
            node {
              id
              createdAt
              physicalLocation { id }
              lineItems(first: 100) {
                edges { node { sku quantity } }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `

    const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { first: 50, after, query: searchQuery } }),
    })

    if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`)

    const json = await res.json() as OrdersResponse
    if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)

    const conn = json.data?.orders
    if (!conn) break

    for (const edge of conn.edges) {
      const order = edge.node
      if (order.physicalLocation?.id !== params.locationId) continue
      for (const li of order.lineItems.edges) {
        const sku = (li.node.sku ?? '').trim().toUpperCase()
        if (!sku) continue
        skuToQty.set(sku, (skuToQty.get(sku) ?? 0) + li.node.quantity)
      }
    }

    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }

  return skuToQty
}
