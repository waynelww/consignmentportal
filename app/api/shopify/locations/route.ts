import { createClient } from '@/lib/supabase/server'
import { fetchShopifyLocations } from '@/lib/shopify/locations'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const locations = await fetchShopifyLocations()
    return Response.json({ locations })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to fetch Shopify locations' }, { status: 502 })
  }
}
