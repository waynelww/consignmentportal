import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  const { searchParams } = request.nextUrl
  const month = searchParams.get('month') ? parseInt(searchParams.get('month')!, 10) : null
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!, 10) : null
  const store_id = searchParams.get('store_id')
  const status = searchParams.get('status')

  if (profile.role === 'store_owner') {
    const effectiveStoreId = store_id ?? profile.store_id
    if (effectiveStoreId !== profile.store_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let query = supabase
    .from('commission_periods')
    .select(`
      *,
      stores:store_id ( store_name, store_code, state, commission_rate )
    `)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })

  const effectiveStoreId = profile.role === 'store_owner' ? profile.store_id : store_id
  if (effectiveStoreId) query = query.eq('store_id', effectiveStoreId)
  if (month) query = query.eq('period_month', month)
  if (year) query = query.eq('period_year', year)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ commissions: data })
}
