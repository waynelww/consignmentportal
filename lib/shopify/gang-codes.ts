import { shopifyGraphQL } from './gang-perk'

// First-timer Gang discount codes on Shopify:
//  - Free pair: RM13.99 off any purchase, single use, once per customer.
//  - Lifetime : 10% off every order, no expiry, unlimited uses.
// Both are restricted to the member's Shopify customer record (same
// pattern as the original standing perk), so the codes are personal.

const CREATE_MUTATION = `
  mutation CreateGangDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`

interface CreateResult {
  discountCodeBasicCreate: {
    codeDiscountNode: { id: string } | null
    userErrors: { field: string[]; message: string }[]
  }
}

async function createDiscount(basicCodeDiscount: Record<string, unknown>): Promise<string> {
  const data = await shopifyGraphQL<CreateResult>(CREATE_MUTATION, { basicCodeDiscount })
  const { codeDiscountNode, userErrors } = data.discountCodeBasicCreate
  if (userErrors.length || !codeDiscountNode) {
    throw new Error(`discountCodeBasicCreate failed: ${userErrors.map((e) => e.message).join('; ') || 'no node returned'}`)
  }
  return codeDiscountNode.id
}

export async function createFreePairDiscount(customerId: string, code: string): Promise<string> {
  return createDiscount({
    title: `Gang Free Pair — ${code}`,
    code,
    startsAt: new Date().toISOString(),
    appliesOncePerCustomer: true,
    usageLimit: 1,
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
    context: { customers: { add: [customerId] } },
    customerGets: {
      items: { all: true },
      value: { discountAmount: { amount: '13.99', appliesOnEachItem: false } },
    },
  })
}

export async function createLifetimeDiscount(customerId: string, code: string): Promise<string> {
  return createDiscount({
    title: `Gang Lifetime 10% — ${code}`,
    code,
    startsAt: new Date().toISOString(),
    appliesOncePerCustomer: false,
    usageLimit: null,
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
    context: { customers: { add: [customerId] } },
    customerGets: {
      items: { all: true },
      value: { percentage: 0.10 },
    },
  })
}
