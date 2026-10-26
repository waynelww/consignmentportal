import { createAdminClient } from '@/lib/supabase/admin'
import { shopifyGraphQL } from '@/lib/shopify/gang-perk'

// Incrementally syncs Shopify orders (with line items) into the
// shopify_orders / shopify_order_items tables for the performance dashboard.
//
// One mechanism covers both backfill and steady-state: we walk an
// `updated_at` watermark forward (an order's updated_at >= created_at, and
// refunds/cancellations bump updated_at, so edits re-surface and the
// idempotent upserts self-correct history). The watermark is persisted in
// the `settings` row `shopify_orders_sync` after every page, so a killed
// function (Vercel Hobby's 60s ceiling) loses nothing — callers just invoke
// again until `done: true`.

const SYNC_SETTINGS_KEY = 'shopify_orders_sync'
const DEFAULT_BUDGET_MS = 45_000
const MAX_PAGES = 20
const PAGE_SIZE = 25 // × lineItems(first: 50) stays well under the 1000-point query-cost cap

interface SyncState {
  cursor: string // ISO updated_at watermark
  last_run_at?: string
  backfill_done?: boolean
}

export interface OrdersSyncResult {
  success: true
  done: boolean
  cursor: string
  pages: number
  ordersUpserted: number
  itemsUpserted: number
  skipped: number
}

export interface OrdersSyncError {
  success: false
  error: string
  status: number
}

interface MoneySet {
  shopMoney: { amount: string }
}

interface OrderNode {
  id: string
  name: string
  processedAt: string
  updatedAt: string
  cancelledAt: string | null
  test: boolean
  displayFinancialStatus: string | null
  sourceName: string | null
  physicalLocation: { id: string; name: string } | null
  currencyCode: string
  subtotalPriceSet: MoneySet | null
  totalDiscountsSet: MoneySet | null
  currentSubtotalPriceSet: MoneySet | null
  totalShippingPriceSet: MoneySet | null
  totalRefundedSet: MoneySet | null
  currentTotalPriceSet: MoneySet | null
  lineItems: {
    edges: {
      node: {
        id: string
        sku: string | null
        title: string | null
        quantity: number
        currentQuantity: number
        discountedTotalSet: MoneySet | null
      }
    }[]
    pageInfo: { hasNextPage: boolean }
  }
}

interface OrdersPage {
  orders: {
    edges: { cursor: string; node: OrderNode }[]
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

const ORDERS_QUERY = `
  query OrdersSync($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      edges {
        cursor
        node {
          id name processedAt updatedAt cancelledAt test
          displayFinancialStatus sourceName
          physicalLocation { id name }
          currencyCode
          subtotalPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          currentSubtotalPriceSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
          currentTotalPriceSet { shopMoney { amount } }
          lineItems(first: 50) {
            edges { node { id sku title quantity currentQuantity
                           discountedTotalSet { shopMoney { amount } } } }
            pageInfo { hasNextPage }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

function money(set: MoneySet | null): number {
  const n = Number(set?.shopMoney.amount ?? 0)
  return Number.isFinite(n) ? n : 0
}

// MYT is UTC+8 with no DST, so a fixed offset is correct.
export function mytDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}

async function fetchOrdersPage(after: string | null, sinceIso: string): Promise<OrdersPage> {
  const variables = {
    first: PAGE_SIZE,
    after,
    query: `updated_at:>='${sinceIso}'`,
  }
  try {
    return await shopifyGraphQL<OrdersPage>(ORDERS_QUERY, variables)
  } catch (err) {
    // One retry after a throttle breather; shopifyGraphQL surfaces GraphQL
    // errors (including THROTTLED) as thrown Errors.
    if (err instanceof Error && /THROTTLED|Throttled/.test(err.message)) {
      await new Promise((r) => setTimeout(r, 1500))
      return shopifyGraphQL<OrdersPage>(ORDERS_QUERY, variables)
    }
    throw err
  }
}

export async function syncShopifyOrders(opts?: {
  cursorOverride?: string // ISO date/datetime — resets the watermark (backfill kickoff)
  budgetMs?: number
}): Promise<OrdersSyncResult | OrdersSyncError> {
  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_TOKEN) {
    return { success: false, status: 500, error: 'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars' }
  }

  const started = Date.now()
  const budgetMs = opts?.budgetMs ?? DEFAULT_BUDGET_MS
  const admin = createAdminClient()

  // Load (or reset) the watermark.
  let state: SyncState
  if (opts?.cursorOverride) {
    state = { cursor: new Date(opts.cursorOverride).toISOString() }
  } else {
    const { data } = await admin.from('settings').select('value').eq('key', SYNC_SETTINGS_KEY).maybeSingle()
    if (data?.value) {
      try {
        state = JSON.parse(data.value) as SyncState
      } catch {
        return { success: false, status: 500, error: `Corrupt ${SYNC_SETTINGS_KEY} settings value` }
      }
    } else {
      // First ever run with no explicit start: last 60 days (the window a
      // custom app can read without the read_all_orders scope).
      state = { cursor: new Date(Date.now() - 60 * 86400_000).toISOString() }
    }
  }

  const persistState = async (next: SyncState) => {
    await admin.from('settings').upsert(
      {
        key: SYNC_SETTINGS_KEY,
        value: JSON.stringify(next),
        description: 'Shopify orders sync watermark (performance dashboard)',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
  }

  let after: string | null = null
  let pages = 0
  let ordersUpserted = 0
  let itemsUpserted = 0
  let skipped = 0
  let maxUpdatedAt = state.cursor
  let done = false
  const sinceIso = state.cursor // fixed for the whole run; endCursor pages within it

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await fetchOrdersPage(after, sinceIso)
      const conn = data.orders
      pages++

      const orderRows: Record<string, unknown>[] = []
      const itemRowsByOrder = new Map<string, Record<string, unknown>[]>()

      for (const { node } of conn.edges) {
        if (node.updatedAt > maxUpdatedAt) maxUpdatedAt = node.updatedAt
        if (node.test) {
          skipped++
          continue
        }
        if (node.lineItems.pageInfo.hasNextPage) {
          console.warn(`[sync-orders] order ${node.name} has >50 line items — tail lines not synced`)
        }
        orderRows.push({
          id: node.id,
          name: node.name,
          processed_at: node.processedAt,
          processed_date_myt: mytDate(node.processedAt),
          updated_at_shopify: node.updatedAt,
          cancelled_at: node.cancelledAt,
          is_test: node.test,
          financial_status: node.displayFinancialStatus,
          source_name: node.sourceName,
          location_id: node.physicalLocation?.id ?? null,
          location_name: node.physicalLocation?.name ?? null,
          currency: node.currencyCode,
          gross_sales: money(node.subtotalPriceSet) + money(node.totalDiscountsSet),
          discounts: money(node.totalDiscountsSet),
          current_subtotal: money(node.currentSubtotalPriceSet),
          shipping: money(node.totalShippingPriceSet),
          total_refunded: money(node.totalRefundedSet),
          current_total: money(node.currentTotalPriceSet),
          synced_at: new Date().toISOString(),
        })
        itemRowsByOrder.set(
          node.id,
          node.lineItems.edges.map(({ node: li }) => ({
            order_id: node.id,
            line_item_id: li.id,
            sku: (li.sku ?? '').trim().toUpperCase() || null,
            title: li.title,
            quantity: li.quantity,
            current_quantity: li.currentQuantity,
            line_revenue: money(li.discountedTotalSet),
          })),
        )
      }

      if (orderRows.length) {
        const { error: orderErr } = await admin.from('shopify_orders').upsert(orderRows, { onConflict: 'id' })
        if (orderErr) {
          return { success: false, status: 500, error: `Order upsert failed: ${orderErr.message}` }
        }
        ordersUpserted += orderRows.length

        // Delete-then-insert line items per order (handles edited/removed
        // lines), in parallel chunks like sync-inventory.ts.
        const orderIds = [...itemRowsByOrder.keys()]
        const CHUNK = 20
        for (let i = 0; i < orderIds.length; i += CHUNK) {
          const slice = orderIds.slice(i, i + CHUNK)
          const results = await Promise.all(
            slice.map(async (orderId) => {
              const rows = itemRowsByOrder.get(orderId) ?? []
              const del = await admin.from('shopify_order_items').delete().eq('order_id', orderId)
              if (del.error) return del
              if (!rows.length) return del
              return admin.from('shopify_order_items').insert(rows)
            }),
          )
          const failed = results.find((r) => r.error)
          if (failed?.error) {
            return { success: false, status: 500, error: `Line item write failed: ${failed.error.message}` }
          }
          itemsUpserted += slice.reduce((n, id) => n + (itemRowsByOrder.get(id)?.length ?? 0), 0)
        }
      }

      // Persist progress after every page so a killed function resumes cleanly.
      // Inclusive >= re-reads the watermark order on the next run; upserts make
      // that overlap harmless.
      await persistState({
        cursor: maxUpdatedAt,
        last_run_at: new Date().toISOString(),
        backfill_done: !conn.pageInfo.hasNextPage,
      })

      if (!conn.pageInfo.hasNextPage) {
        done = true
        break
      }
      after = conn.pageInfo.endCursor
      if (Date.now() - started > budgetMs) break
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Shopify orders fetch failed'
    return { success: false, status: 502, error: message }
  }

  return { success: true, done, cursor: maxUpdatedAt, pages, ordersUpserted, itemsUpserted, skipped }
}
