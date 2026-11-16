/**
 * GET or POST /api/cron/sync-shopify-inventory
 * Refreshes Shopify links, SKUs and photos (lib/shopify/catalogue-match.ts),
 * then products.hq_available_qty from the Shopify Office (HQ) location.
 *
 * Callers:
 *  - Vercel Cron, daily 03:30 MY time = 19:30 UTC (GET, Authorization: Bearer CRON_SECRET).
 *    30 min after the image sync to avoid hammering the Shopify API at the same moment.
 *  - Supabase pg_cron, hourly (POST, single-use x-cron-token from cron_tokens).
 *    See supabase/migrations/20261116_shopify_hourly_sync_cron.sql.
 */
import { type NextRequest } from 'next/server'
import { syncShopifyInventory, type SyncSource } from '@/lib/shopify/sync-inventory'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 60

const CRON_TOKEN_JOB = 'shopify-inventory'
const CRON_TOKEN_TTL_MS = 10 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Returns the sync source for an authorised request, or null when it is not authorised. */
async function authorisedSource(request: NextRequest): Promise<SyncSource | null> {
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return 'nightly'

  const token = request.headers.get('x-cron-token')
  if (!token || !UUID_RE.test(token)) return null

  // Single use: one atomic delete that matches only a fresh token for this job.
  const { data, error } = await createAdminClient()
    .from('cron_tokens')
    .delete()
    .eq('token', token)
    .eq('job', CRON_TOKEN_JOB)
    .gte('created_at', new Date(Date.now() - CRON_TOKEN_TTL_MS).toISOString())
    .select('token')

  if (error) {
    console.error('[cron sync-shopify-inventory] cron token check failed:', error.message)
    return null
  }
  return (data?.length ?? 0) > 0 ? 'hourly' : null
}

async function runSync(request: NextRequest) {
  const source = await authorisedSource(request)
  if (!source) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  const result = await syncShopifyInventory(source)
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

export async function GET(request: NextRequest) {
  return runSync(request)
}

// pg_net sends POST from the hourly pg_cron job.
export async function POST(request: NextRequest) {
  return runSync(request)
}
