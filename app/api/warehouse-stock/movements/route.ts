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
  if (!productId) return Response.json({ error: 'product_id is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('warehouse_stock_movements')
    .select('*, created_by_profile:profiles(full_name)')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ movements: data ?? [] })
}
