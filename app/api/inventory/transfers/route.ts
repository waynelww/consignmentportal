import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const productId = request.nextUrl.searchParams.get('product_id')
  const locationId = request.nextUrl.searchParams.get('location_id')
  if (!productId && !locationId) {
    return Response.json({ error: 'product_id or location_id is required' }, { status: 400 })
  }

  let query = supabase
    .from('stock_transfers')
    .select(`
      *,
      from_location:from_location_id(name, type),
      to_location:to_location_id(name, type),
      created_by_profile:profiles(full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (productId) query = query.eq('product_id', productId)
  if (locationId) query = query.or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ transfers: data ?? [] })
}
