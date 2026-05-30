import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncShopifyVariantImages } from '@/lib/shopify/sync-variant-images'

// Admin-triggered sync (button on /admin/products page).
// For automatic daily sync, see /api/cron/sync-shopify-images.

export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await syncShopifyVariantImages()
  if (!result.success) {
    return Response.json({ error: result.error }, { status: result.status })
  }
  return Response.json(result)
}
