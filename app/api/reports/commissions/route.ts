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
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const monthParam = searchParams.get('month')
  const yearParam = searchParams.get('year')

  if (!monthParam || !yearParam) {
    return Response.json({ error: 'month and year are required' }, { status: 400 })
  }

  const month = parseInt(monthParam, 10)
  const year = parseInt(yearParam, 10)

  if (isNaN(month) || month < 1 || month > 12 || isNaN(year)) {
    return Response.json({ error: 'Invalid month or year' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('commission_periods')
    .select(`
      *,
      stores:store_id (
        store_code,
        store_name,
        city,
        state,
        store_type,
        commission_rate,
        bank_name,
        bank_account_number,
        bank_account_name
      )
    `)
    .eq('period_month', month)
    .eq('period_year', year)
    .order('commission_amount', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const totals = {
    total_commission: Number((data ?? []).reduce((sum, cp) => sum + cp.commission_amount, 0).toFixed(2)),
    total_xocks_revenue: Number((data ?? []).reduce((sum, cp) => sum + cp.xocks_revenue, 0).toFixed(2)),
    total_revenue: Number((data ?? []).reduce((sum, cp) => sum + cp.total_revenue, 0).toFixed(2)),
    total_units_sold: (data ?? []).reduce((sum, cp) => sum + cp.total_units_sold, 0),
    pending_count: (data ?? []).filter((cp) => cp.status === 'pending').length,
    approved_count: (data ?? []).filter((cp) => cp.status === 'approved').length,
    paid_count: (data ?? []).filter((cp) => cp.status === 'paid').length,
  }

  return Response.json({ commissions: data, period: { month, year }, totals })
}
