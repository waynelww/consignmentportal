/**
 * POST /api/admin/sync-shopify-orders
 * Session-gated "Sync now" for the performance dashboard. Same incremental
 * sync as the cron endpoint; the client loops while done === false so each
 * request stays well under Vercel's 60s ceiling.
 */
import { createClient } from '@/lib/supabase/server'
import { syncShopifyOrders } from '@/lib/shopify/sync-orders'

export const maxDuration = 60

export async function POST() {
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

  const result = await syncShopifyOrders()
  if (!result.success) {
    return Response.json({ error: result.error }, { status: result.status })
  }
  return Response.json(result)
}
