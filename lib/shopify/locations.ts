const SHOPIFY_API_VERSION = '2024-10'

export interface ShopifyLocation {
  id: string
  name: string
}

export async function fetchShopifyLocations(): Promise<ShopifyLocation[]> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) throw new Error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars')

  const query = `
    query Locations {
      locations(first: 50) {
        edges { node { id name } }
      }
    }
  `

  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`)

  const json = await res.json() as {
    data?: { locations: { edges: { node: ShopifyLocation }[] } }
    errors?: { message: string }[]
  }
  if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)

  return (json.data?.locations.edges ?? []).map((e) => e.node)
}
