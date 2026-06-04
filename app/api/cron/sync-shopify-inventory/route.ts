/**
 * GET /api/cron/sync-shopify-inventory
 * Daily Vercel Cron — refreshes products.shopify_inventory_qty from Shopify.
 * Schedule: 03:30 MY time = 19:30 UTC (30 min after the image sync to avoid
 * hammering the Shopify API at the exact same moment).
 */
import { type NextRequest } from 'next/server'
import { syncShopifyInventory } from '@/lib/shopify/sync-inventory'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  const result = await syncShopifyInventory()
  const duration_ms = Date.now() - start

  if (!result.success) {
    console.error('[cron sync-shopify-inventory]', result.error)
    return Response.json({ ok: false, error: result.error, duration_ms }, { status: result.status })
  }

  console.log(
    `[cron sync-shopify-inventory] ok · fetched=${result.shopify_variants_fetched} · ` +
    `updated=${result.updated} · unchanged=${result.unchanged} · ` +
    `not_found=${result.not_found_in_shopify} · ` +
    `total_pairs=${result.total_warehouse_pairs} · ${duration_ms}ms`,
  )

  return Response.json({ ok: true, duration_ms, ...result })
}
