import { shopifyGraphQL } from './gang-perk'

export interface ShopifyOrderContact {
  orderName: string // "#1043"
  phone: string | null
  email: string | null
  customerName: string | null
  financialStatus: string | null
}

const ORDER_FIELDS = `
  name
  displayFinancialStatus
  email
  phone
  billingAddress { phone name }
  shippingAddress { phone name }
  customer { phone email displayName }
`

function extract(node: Record<string, any>): ShopifyOrderContact {
  const phone =
    node.phone ??
    node.customer?.phone ??
    node.shippingAddress?.phone ??
    node.billingAddress?.phone ??
    null
  return {
    orderName: node.name,
    phone,
    email: node.email ?? node.customer?.email ?? null,
    customerName: node.customer?.displayName ?? node.shippingAddress?.name ?? node.billingAddress?.name ?? null,
    financialStatus: node.displayFinancialStatus ?? null,
  }
}

/** Fetch an order by its numeric Shopify id (from a webhook payload). */
export async function getOrderById(orderId: string | number): Promise<ShopifyOrderContact | null> {
  const gid = `gid://shopify/Order/${orderId}`
  const data = await shopifyGraphQL<{ order: Record<string, any> | null }>(
    `query($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`,
    { id: gid },
  )
  return data.order ? extract(data.order) : null
}

/** Fetch an order by its customer-facing name ("1043" or "#1043"). */
export async function getOrderByName(orderNumber: string): Promise<ShopifyOrderContact | null> {
  const name = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`
  const data = await shopifyGraphQL<{ orders: { nodes: Record<string, any>[] } }>(
    `query($query: String!) { orders(first: 1, query: $query) { nodes { ${ORDER_FIELDS} } } }`,
    { query: `name:${JSON.stringify(name)}` },
  )
  const node = data.orders.nodes[0]
  return node ? extract(node) : null
}
