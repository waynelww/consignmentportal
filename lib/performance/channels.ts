import type { SupabaseClient } from '@supabase/supabase-js'

// Channel adapters for the performance dashboard. Every sales source is
// reduced to the same shape so the summary route can compose them; adding a
// channel = one raw table + one adapter here. Ad spend is NOT a channel —
// it joins at the route level for ROAS.
//
// Money semantics (operator handbook rule 6): "revenue" here is always the
// customer-paid amount. The Xocks-receivable view (consignment
// xocks_revenue) is carried alongside, never silently substituted.

export type ChannelKey = 'online' | 'pos' | 'events' | 'consignment' | 'shopee' | 'tiktok'

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  online: 'Shopify Online',
  pos: 'POS Retail',
  events: 'Booth Events',
  consignment: 'Consignment',
  shopee: 'Shopee',
  tiktok: 'TikTok Shop',
}

export interface SkuAgg {
  sku: string
  name: string
  units: number
  revenue: number
  byChannel: Partial<Record<ChannelKey, number>> // revenue per channel
}

export interface DailyPoint {
  date: string // YYYY-MM-DD MYT
  revenue: number
  units: number
  orders: number
}

export interface ChannelAgg {
  key: ChannelKey
  revenue: number
  units: number
  orders: number
  daily: Map<string, DailyPoint>
  sublocations?: Map<string, { revenue: number; units: number }>
}

export function emptyChannel(key: ChannelKey): ChannelAgg {
  return { key, revenue: 0, units: 0, orders: 0, daily: new Map() }
}

export function bumpDaily(ch: ChannelAgg, date: string, revenue: number, units: number, orders: number) {
  const point = ch.daily.get(date) ?? { date, revenue: 0, units: 0, orders: 0 }
  point.revenue += revenue
  point.units += units
  point.orders += orders
  ch.daily.set(date, point)
  ch.revenue += revenue
  ch.units += units
  ch.orders += orders
}

// Generic paged select — Supabase silently truncates at 1000 rows otherwise
// (same loop as app/api/admin/export/route.ts).
const PAGE = 1000
export async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

interface ShopifyOrderRow {
  id: string
  processed_date_myt: string
  source_name: string | null
  location_id: string | null
  location_name: string | null
  current_subtotal: number
}

interface ShopifyItemRow {
  order_id: string
  sku: string | null
  title: string | null
  quantity: number
  current_quantity: number
  line_revenue: number
}

export interface EventRef {
  id: string
  name: string
  start_date: string
  end_date: string | null
  status: string
  shopify_location_id: string | null
}

export interface ShopifyAggResult {
  online: ChannelAgg
  pos: ChannelAgg
  events: ChannelAgg
  perEvent: Map<string, { revenue: number; units: number; orders: number }> // keyed by event id
  skus: Map<string, SkuAgg>
}

export async function aggShopify(
  db: SupabaseClient,
  start: string,
  end: string,
  eventRefs: EventRef[],
): Promise<ShopifyAggResult> {
  const orders = await pageAll<ShopifyOrderRow>((from, to) =>
    db
      .from('shopify_orders')
      .select('id, processed_date_myt, source_name, location_id, location_name, current_subtotal')
      .gte('processed_date_myt', start)
      .lte('processed_date_myt', end)
      .is('cancelled_at', null)
      .eq('is_test', false)
      .order('processed_date_myt', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const eventByLocation = new Map<string, EventRef>()
  for (const ev of eventRefs) {
    if (ev.shopify_location_id) eventByLocation.set(ev.shopify_location_id, ev)
  }

  const online = emptyChannel('online')
  const pos = emptyChannel('pos')
  const events = emptyChannel('events')
  pos.sublocations = new Map()
  const perEvent = new Map<string, { revenue: number; units: number; orders: number }>()

  // Classify each order once (read-time classification: an event created
  // after its orders still reclaims them by location match).
  const channelByOrder = new Map<string, ChannelAgg>()
  const eventIdByOrder = new Map<string, string>()
  for (const o of orders) {
    const matchedEvent = o.location_id ? eventByLocation.get(o.location_id) : undefined
    let ch: ChannelAgg
    if (o.source_name === 'pos' && matchedEvent) {
      ch = events
      eventIdByOrder.set(o.id, matchedEvent.id)
    } else if (o.source_name === 'pos') {
      ch = pos
    } else {
      ch = online
    }
    channelByOrder.set(o.id, ch)
    bumpDaily(ch, o.processed_date_myt, o.current_subtotal, 0, 1)
    if (ch === pos && o.location_name) {
      const sub = pos.sublocations!.get(o.location_name) ?? { revenue: 0, units: 0 }
      sub.revenue += o.current_subtotal
      pos.sublocations!.set(o.location_name, sub)
    }
    if (ch === events && matchedEvent) {
      const pe = perEvent.get(matchedEvent.id) ?? { revenue: 0, units: 0, orders: 0 }
      pe.revenue += o.current_subtotal
      pe.orders += 1
      perEvent.set(matchedEvent.id, pe)
    }
  }

  // Line items for units + per-SKU revenue, fetched in id chunks.
  const skus = new Map<string, SkuAgg>()
  const orderIds = orders.map((o) => o.id)
  const dateByOrder = new Map(orders.map((o) => [o.id, o.processed_date_myt]))
  const locationByOrder = new Map(orders.map((o) => [o.id, o.location_name]))
  const IN_CHUNK = 200
  for (let i = 0; i < orderIds.length; i += IN_CHUNK) {
    const slice = orderIds.slice(i, i + IN_CHUNK)
    const items = await pageAll<ShopifyItemRow>((from, to) =>
      db
        .from('shopify_order_items')
        .select('order_id, sku, title, quantity, current_quantity, line_revenue')
        .in('order_id', slice)
        .order('order_id', { ascending: true })
        .order('line_item_id', { ascending: true })
        .range(from, to),
    )
    for (const it of items) {
      const ch = channelByOrder.get(it.order_id)
      if (!ch) continue
      const units = it.current_quantity
      // Prorate line revenue when part of the line was refunded/removed.
      const revenue =
        it.quantity > 0 && it.current_quantity !== it.quantity
          ? (it.line_revenue / it.quantity) * it.current_quantity
          : it.line_revenue
      const date = dateByOrder.get(it.order_id)!
      // units ride on the daily buckets (orders/revenue were counted above)
      bumpDaily(ch, date, 0, units, 0)
      if (ch === pos) {
        const locationName = locationByOrder.get(it.order_id)
        if (locationName) {
          const sub = pos.sublocations!.get(locationName)
          if (sub) sub.units += units
        }
      }
      const evId = eventIdByOrder.get(it.order_id)
      if (evId) {
        const pe = perEvent.get(evId)
        if (pe) pe.units += units
      }
      const key = it.sku ?? `~${(it.title ?? 'Unknown').toUpperCase()}`
      const agg = skus.get(key) ?? { sku: it.sku ?? '—', name: it.title ?? it.sku ?? 'Unknown', units: 0, revenue: 0, byChannel: {} }
      agg.units += units
      agg.revenue += revenue
      agg.byChannel[ch.key] = (agg.byChannel[ch.key] ?? 0) + revenue
      skus.set(key, agg)
    }
  }

  return { online, pos, events, perEvent, skus }
}

interface SaleRow {
  sale_date: string
  quantity: number
  total_amount: number
  xocks_revenue: number
  sale_group_id: string | null
  store: { store_code: string; store_name: string } | null
  product: { sku: string; name: string } | null
}

export interface StoreAgg {
  storeCode: string
  storeName: string
  revenue: number // total_amount — what customers paid at the store
  xocksRevenue: number // what the store remits to Xocks
  units: number
}

export interface ConsignmentAggResult {
  channel: ChannelAgg
  xocksRevenue: number
  stores: StoreAgg[]
  skus: Map<string, SkuAgg>
}

export async function aggConsignment(db: SupabaseClient, start: string, end: string): Promise<ConsignmentAggResult> {
  const rows = await pageAll<SaleRow>((from, to) =>
    db
      .from('sales')
      .select('sale_date, quantity, total_amount, xocks_revenue, sale_group_id, store:stores(store_code, store_name), product:products(sku, name)')
      .gte('sale_date', start)
      .lte('sale_date', end)
      .order('sale_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: SaleRow[] | null; error: { message: string } | null }>,
  )

  const channel = emptyChannel('consignment')
  const storeMap = new Map<string, StoreAgg>()
  const skus = new Map<string, SkuAgg>()
  const groups = new Set<string>()
  let ungrouped = 0
  let xocksRevenue = 0

  for (const r of rows) {
    // Rows without a sale_group_id predate multi-item checkouts — count each
    // as its own transaction.
    const orderKey = r.sale_group_id ?? `ungrouped:${ungrouped++}`
    const isNewGroup = !groups.has(orderKey)
    groups.add(orderKey)
    bumpDaily(channel, r.sale_date, r.total_amount, r.quantity, isNewGroup ? 1 : 0)
    xocksRevenue += r.xocks_revenue

    const code = r.store?.store_code ?? '??'
    const store = storeMap.get(code) ?? {
      storeCode: code,
      storeName: r.store?.store_name ?? 'Unknown store',
      revenue: 0,
      xocksRevenue: 0,
      units: 0,
    }
    store.revenue += r.total_amount
    store.xocksRevenue += r.xocks_revenue
    store.units += r.quantity
    storeMap.set(code, store)

    const sku = r.product?.sku ?? '—'
    const agg = skus.get(sku) ?? { sku, name: r.product?.name ?? sku, units: 0, revenue: 0, byChannel: {} }
    agg.units += r.quantity
    agg.revenue += r.total_amount
    agg.byChannel.consignment = (agg.byChannel.consignment ?? 0) + r.total_amount
    skus.set(sku, agg)
  }

  return { channel, xocksRevenue, stores: [...storeMap.values()], skus }
}

interface MarketplaceRow {
  platform: 'shopee' | 'tiktok'
  order_id: string
  order_date_myt: string
  sku: string | null
  product_name: string | null
  quantity: number
  line_revenue: number
}

export interface MarketplaceAggResult {
  shopee: ChannelAgg
  tiktok: ChannelAgg
  skus: Map<string, SkuAgg>
}

export async function aggMarketplace(db: SupabaseClient, start: string, end: string): Promise<MarketplaceAggResult> {
  const rows = await pageAll<MarketplaceRow>((from, to) =>
    db
      .from('marketplace_sales')
      .select('platform, order_id, order_date_myt, sku, product_name, quantity, line_revenue')
      .gte('order_date_myt', start)
      .lte('order_date_myt', end)
      .order('order_date_myt', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const shopee = emptyChannel('shopee')
  const tiktok = emptyChannel('tiktok')
  const skus = new Map<string, SkuAgg>()
  const seenOrders = new Set<string>()

  for (const r of rows) {
    const ch = r.platform === 'shopee' ? shopee : tiktok
    const orderKey = `${r.platform}:${r.order_id}`
    const isNewOrder = !seenOrders.has(orderKey)
    seenOrders.add(orderKey)
    bumpDaily(ch, r.order_date_myt, r.line_revenue, r.quantity, isNewOrder ? 1 : 0)

    const key = r.sku ?? `~${(r.product_name ?? 'Unknown').toUpperCase()}`
    const agg = skus.get(key) ?? {
      sku: r.sku ?? '—',
      name: r.product_name ?? r.sku ?? 'Unknown',
      units: 0,
      revenue: 0,
      byChannel: {},
    }
    agg.units += r.quantity
    agg.revenue += r.line_revenue
    agg.byChannel[ch.key] = (agg.byChannel[ch.key] ?? 0) + r.line_revenue
    skus.set(key, agg)
  }

  return { shopee, tiktok, skus }
}

export function mergeSkuMaps(maps: Map<string, SkuAgg>[]): SkuAgg[] {
  const merged = new Map<string, SkuAgg>()
  for (const m of maps) {
    for (const [key, agg] of m) {
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...agg, byChannel: { ...agg.byChannel } })
        continue
      }
      existing.units += agg.units
      existing.revenue += agg.revenue
      for (const [ch, rev] of Object.entries(agg.byChannel) as [ChannelKey, number][]) {
        existing.byChannel[ch] = (existing.byChannel[ch] ?? 0) + rev
      }
    }
  }
  return [...merged.values()]
}
