// Xocks Gang phone-number checkout perk: find-or-create a Shopify customer
// for a Gang member's phone number, then issue them a personal "amount off
// order" discount code (their phone number) once their order is verified.

const SHOPIFY_API_VERSION = '2024-10'

interface ShopifyGraphQLResponse<T> {
  data?: T
  errors?: { message: string }[]
}

export async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) {
    throw new Error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars')
  }

  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}: ${await res.text()}`)
  }

  const json = (await res.json()) as ShopifyGraphQLResponse<T>
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)
  }
  if (!json.data) {
    throw new Error('Shopify GraphQL: empty response')
  }
  return json.data
}

function toE164(phone: string): string {
  return phone.startsWith('+') ? phone : `+${phone}`
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/)
  return { firstName: parts[0] || name, lastName: parts.slice(1).join(' ') || '' }
}

export async function findOrCreateCustomerByPhone(
  phone: string,
  name: string,
  email: string,
): Promise<string> {
  const e164 = toE164(phone)

  const searchData = await shopifyGraphQL<{
    customers: { nodes: { id: string }[] }
  }>(
    `query FindCustomer($query: String!) {
      customers(first: 1, query: $query) {
        nodes { id }
      }
    }`,
    { query: `phone:${e164}` },
  )

  const existing = searchData.customers.nodes[0]
  if (existing) return existing.id

  const { firstName, lastName } = splitName(name)
  const createData = await shopifyGraphQL<{
    customerCreate: { customer: { id: string } | null; userErrors: { field: string[]; message: string }[] }
  }>(
    `mutation CreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`,
    { input: { phone: e164, email, firstName, lastName } },
  )

  const { customer, userErrors } = createData.customerCreate
  if (userErrors.length || !customer) {
    throw new Error(`customerCreate failed: ${userErrors.map((e) => e.message).join('; ') || 'no customer returned'}`)
  }
  return customer.id
}

export interface GangPerkConfig {
  price_per_pair: number
  free_pairs: number
  min_buy_pairs: number
}

export async function createGangDiscountCode({
  customerId,
  code,
  config,
}: {
  customerId: string
  code: string
  config: GangPerkConfig
}): Promise<string> {
  const minQuantity = config.min_buy_pairs + config.free_pairs
  const discountAmount = Math.round(config.price_per_pair * config.free_pairs * 100) / 100

  const data = await shopifyGraphQL<{
    discountCodeBasicCreate: {
      codeDiscountNode: { id: string } | null
      userErrors: { field: string[]; message: string }[]
    }
  }>(
    `mutation CreateGangDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }`,
    {
      basicCodeDiscount: {
        title: `Xocks Gang — ${code}`,
        code,
        startsAt: new Date().toISOString(),
        appliesOncePerCustomer: false,
        usageLimit: null,
        combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
        context: { customers: { add: [customerId] } },
        minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: String(minQuantity) } },
        customerGets: {
          items: { all: true },
          value: { discountAmount: { amount: String(discountAmount), appliesOnEachItem: false } },
        },
      },
    },
  )

  const { codeDiscountNode, userErrors } = data.discountCodeBasicCreate
  if (userErrors.length || !codeDiscountNode) {
    throw new Error(`discountCodeBasicCreate failed: ${userErrors.map((e) => e.message).join('; ') || 'no node returned'}`)
  }
  return codeDiscountNode.id
}
