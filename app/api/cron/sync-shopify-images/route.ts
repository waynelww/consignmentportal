/**
 * GET /api/cron/sync-shopify-images
 * Called by Vercel Cron daily at 19:00 UTC = 03:00 Malaysia time.
 * Pulls every variant from Shopify and refreshes products.image_url in the DB.
 *
 * Requires env vars on Vercel:
 *   CRON_SECRET             (shared with other crons)
 *   SHOPIFY_STORE_DOMAIN
 *   SHOPIFY_ADMIN_TOKEN
 *   SUPABASE_SERVICE_ROLE_KEY  (used by admin client)
 */
import { type NextRequest } from 'next/server'
import { syncShopifyVariantImages } from '@/lib/shopify/sync-variant-images'

export const maxDuration = 60 // give Shopify pagination + DB writes room

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  const result = await syncShopifyVariantImages()
  const duration_ms = Date.now() - start

  if (!result.success) {
    console.error('[cron sync-shopify-images]', result.error)
    return Response.json({ ok: false, error: result.error, duration_ms }, { status: result.status })
  }

  console.log(
    `[cron sync-shopify-images] ok · fetched=${result.shopify_variants_fetched} · ` +
    `updated=${result.updated} · unchanged=${result.unchanged} · ` +
    `not_found=${result.not_found_in_shopify} · ${duration_ms}ms`,
  )

  return Response.json({ ok: true, duration_ms, ...result })
}
