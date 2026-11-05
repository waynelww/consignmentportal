/**
 * GET /api/cron/sync-shopify-inventory
 * Daily Vercel Cron — refreshes Shopify links, SKUs and photos (lib/shopify/catalogue-match.ts),
 * then products.hq_available_qty from the Shopify Office (HQ) location.
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
  const result = await syncShopifyInventory('nightly')
  const duration_ms = Date.now() - start

  if (!result.success) {
    console.error('[cron sync-shopify-inventory]', result.error)
    return Response.json({ ok: false, error: result.error, duration_ms }, { status: result.status })
  }

  console.log(
    `[cron sync-shopify-inventory] ok · levels=${result.levels_fetched} · ` +
    `updated=${result.updated} · ` +
    `not_at_hq=${result.not_at_hq} · out_at_hq=${result.out_at_hq} · ` +
    `total_hq_pairs=${result.total_hq_pairs} · ${duration_ms}ms`,
  )
  // Same lines the admin Refresh shows: SKU renames, photos, conflicts, not linked.
  for (const line of result.summary) console.log(`[cron sync-shopify-inventory] ${line}`)

  return Response.json({ ok: true, duration_ms, ...result })
}
