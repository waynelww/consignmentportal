/**
 * GET /api/performance/summary?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Whole-business performance aggregation for /admin/performance.
 * Dates are MYT calendar dates (all channel tables store MYT DATE columns).
 *
 * Revenue semantics (handbook rule 6): `businessRevenue` is customer-paid
 * (Shopify current_subtotal + consignment total_amount + marketplace line
 * revenue); `xocksReceivable` swaps consignment to xocks_revenue.
 * commission_amount is never used here.
 */
import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { cachedAdminJson } from '@/lib/cache'
import {
  aggConsignment,
  aggMarketplace,
  aggShopify,
  CHANNEL_LABELS,
  mergeSkuMaps,
  type ChannelAgg,
  type ChannelKey,
  type EventRef,
} from '@/lib/performance/channels'
import { SAMPLE_META, SAMPLE_ORGANIC } from '@/lib/performance/sample-data'

export const maxDuration = 60

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function serializeChannel(ch: ChannelAgg) {
  return {
    key: ch.key,
    label: CHANNEL_LABELS[ch.key],
    revenue: round2(ch.revenue),
    units: ch.units,
    orders: ch.orders,
    sublocations: ch.sublocations
      ? [...ch.sublocations.entries()].map(([name, s]) => ({ name, revenue: round2(s.revenue), units: s.units }))
      : undefined,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const start = request.nextUrl.searchParams.get('start')
  const end = request.nextUrl.searchParams.get('end')
  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end) || start > end) {
    return Response.json({ error: 'start and end must be YYYY-MM-DD with start <= end' }, { status: 400 })
  }

  // shopify_orders / marketplace tables have RLS with no policies — reads go
  // through the (cookie-less) service client; access was checked above.
  const db = await createServiceClient()

  try {
    // Events overlapping the range (for Shopify order classification + the
    // events block) and their hand-entered targets.
    const { data: eventRows, error: evErr } = await db
      .from('events')
      .select('id, name, start_date, end_date, status, shopify_location_id')
      .lte('start_date', end)
      .or(`end_date.gte.${start},end_date.is.null`)
    if (evErr) throw new Error(evErr.message)
    const eventRefs = (eventRows ?? []) as EventRef[]

    const [shopify, consignment, marketplace] = await Promise.all([
      aggShopify(db, start, end, eventRefs),
      aggConsignment(db, start, end),
      aggMarketplace(db, start, end),
    ])

    // event_targets has no FK to events — best-effort join by name, then by
    // exact start_date. A miss renders "no target linked".
    const { data: targetRows } = await db
      .from('event_targets')
      .select('id, name, start_date, tier2_total, cover_ratio, actual_sales')
    const targets = targetRows ?? []
    const findTarget = (ev: EventRef) =>
      targets.find((t) => t.name.trim().toLowerCase() === ev.name.trim().toLowerCase()) ??
      targets.find((t) => t.start_date === ev.start_date) ??
      null

    const eventsBlock = eventRefs
      .map((ev) => {
        const perf = shopify.perEvent.get(ev.id)
        const target = findTarget(ev)
        return {
          id: ev.id,
          name: ev.name,
          status: ev.status,
          dates: ev.end_date && ev.end_date !== ev.start_date ? `${ev.start_date} → ${ev.end_date}` : ev.start_date,
          unitsSold: perf?.units ?? 0,
          orders: perf?.orders ?? 0,
          shopifyRevenue: round2(perf?.revenue ?? 0),
          target: target ? Number(target.tier2_total) : null,
          actualSalesManual: target?.actual_sales != null ? Number(target.actual_sales) : null,
          coverRatio:
            target && Number(target.tier2_total) > 0 && perf
              ? round2(perf.revenue / Number(target.tier2_total))
              : null,
        }
      })
      .sort((a, b) => (a.dates < b.dates ? 1 : -1))

    const channels = [shopify.online, shopify.pos, shopify.events, consignment.channel, marketplace.shopee, marketplace.tiktok]

    // Daily trend across channels.
    const trendDates = new Set<string>()
    for (const ch of channels) for (const d of ch.daily.keys()) trendDates.add(d)
    const trend = [...trendDates].sort().map((date) => {
      const point: Record<string, number | string> = { date }
      for (const ch of channels) point[ch.key] = round2(ch.daily.get(date)?.revenue ?? 0)
      return point
    })

    // Top SKUs across channels, with product names backfilled from the
    // products table where Shopify titles were missing.
    const topSkus = mergeSkuMaps([shopify.skus, consignment.skus, marketplace.skus])
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15)
      .map((s) => ({
        ...s,
        revenue: round2(s.revenue),
        byChannel: Object.fromEntries(
          (Object.entries(s.byChannel) as [ChannelKey, number][]).map(([k, v]) => [k, round2(v)]),
        ),
      }))

    const storesSorted = [...consignment.stores].sort((a, b) => b.revenue - a.revenue)
    const consignmentStores = {
      top: storesSorted.slice(0, 10).map((s) => ({ ...s, revenue: round2(s.revenue), xocksRevenue: round2(s.xocksRevenue) })),
      bottom: storesSorted
        .slice(-10)
        .reverse()
        .map((s) => ({ ...s, revenue: round2(s.revenue), xocksRevenue: round2(s.xocksRevenue) })),
    }

    const shopifyNet = shopify.online.revenue + shopify.pos.revenue + shopify.events.revenue
    const marketplaceGross = marketplace.shopee.revenue + marketplace.tiktok.revenue
    const businessRevenue = shopifyNet + consignment.channel.revenue + marketplaceGross
    const xocksReceivable = shopifyNet + consignment.xocksRevenue + marketplaceGross

    // Freshness: sync watermark + latest upload per platform.
    const { data: syncRow } = await db.from('settings').select('value').eq('key', 'shopify_orders_sync').maybeSingle()
    let shopifyLastSyncedAt: string | null = null
    if (syncRow?.value) {
      try {
        shopifyLastSyncedAt = (JSON.parse(syncRow.value) as { last_run_at?: string }).last_run_at ?? null
      } catch { /* corrupt settings value — badge just shows "never" */ }
    }
    const { data: lastBatches } = await db
      .from('marketplace_upload_batches')
      .select('platform, date_max, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    const lastUpload = (platform: string) => {
      const b = (lastBatches ?? []).find((x) => x.platform === platform)
      return b ? { uploadedAt: b.created_at, dataTo: b.date_max } : null
    }

    // Blended ROAS against sample spend would be misleading — null until
    // Phase 2 wires real Meta spend.
    const onlineRevenue = shopify.online.revenue + marketplaceGross

    return cachedAdminJson({
      period: { start, end },
      totals: {
        businessRevenue: round2(businessRevenue),
        xocksReceivable: round2(xocksReceivable),
        unitsSold: channels.reduce((s, c) => s + c.units, 0),
        orders: channels.reduce((s, c) => s + c.orders, 0),
      },
      channels: channels.map(serializeChannel),
      trend,
      topSkus,
      consignmentStores,
      events: eventsBlock,
      xocksTake: {
        consignmentGross: round2(consignment.channel.revenue),
        consignmentXocks: round2(consignment.xocksRevenue),
        shopifyNet: round2(shopifyNet),
        marketplaceGross: round2(marketplaceGross),
        totalReceivable: round2(xocksReceivable),
      },
      meta: { ...SAMPLE_META, onlineRevenueForBlended: round2(onlineRevenue) },
      organic: SAMPLE_ORGANIC,
      freshness: {
        shopifyLastSyncedAt,
        lastMarketplaceUpload: { shopee: lastUpload('shopee'), tiktok: lastUpload('tiktok') },
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Aggregation failed'
    console.error('[performance summary]', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
