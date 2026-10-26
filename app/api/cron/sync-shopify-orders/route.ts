/**
 * GET /api/cron/sync-shopify-orders
 * Driven by GitHub Actions (Vercel Hobby's 2 cron slots are taken) —
 * incrementally syncs Shopify orders into shopify_orders for the
 * performance dashboard. Call repeatedly until the response has done:true.
 *
 * ?start=YYYY-MM-DD resets the updated_at watermark (backfill kickoff).
 */
import { type NextRequest } from 'next/server'
import { syncShopifyOrders } from '@/lib/shopify/sync-orders'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const key = request.nextUrl.searchParams.get('key')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && key !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = request.nextUrl.searchParams.get('start')
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return Response.json({ error: 'start must be YYYY-MM-DD' }, { status: 400 })
  }

  const t0 = Date.now()
  const result = await syncShopifyOrders(start ? { cursorOverride: start } : undefined)
  const duration_ms = Date.now() - t0

  if (!result.success) {
    console.error('[cron sync-shopify-orders]', result.error)
    return Response.json({ ok: false, error: result.error, duration_ms }, { status: result.status })
  }

  console.log(
    `[cron sync-shopify-orders] ok · done=${result.done} · pages=${result.pages} · ` +
      `orders=${result.ordersUpserted} · items=${result.itemsUpserted} · ` +
      `cursor=${result.cursor} · ${duration_ms}ms`,
  )

  return Response.json({ ok: true, duration_ms, ...result })
}
