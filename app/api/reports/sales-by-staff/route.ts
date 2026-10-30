import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isTestStore, loadTestStoreIds } from '@/lib/stores/test-accounts'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSalesByStaff, type SaleForStaffReport } from '@/lib/reports/sales-by-staff'

const PAGE = 1000

/**
 * GET /api/reports/sales-by-staff?month=YYYY-MM[&store_id=…]
 * Admin only. Sales for one calendar month, grouped by store and keyed-in-by.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin' && profile?.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const month = searchParams.get('month')
  const storeId = searchParams.get('store_id')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }
  const [y, m] = month.split('-').map(Number)
  if (m < 1 || m > 12) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  const lastDay = new Date(y, m, 0).getDate()
  const from = `${month}-01`
  const to = `${month}-${String(lastDay).padStart(2, '0')}`

  // Page through every sale in the month
  type Raw = {
    store_id: string; quantity: number; total_amount: number
    store_staff_id: string | null; recorded_by: string | null
    stores: { store_code: string; store_name: string } | null
    staff: { name: string } | null
  }
  const raw: Raw[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from('sales')
      .select('store_id, quantity, total_amount, store_staff_id, recorded_by, stores:store_id(store_code, store_name), staff:store_staff_id(name)')
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (storeId) q = q.eq('store_id', storeId)
    const { data, error } = await q
    if (error) return Response.json({ error: error.message }, { status: 500 })
    raw.push(...((data ?? []) as unknown as Raw[]))
    if (!data || data.length < PAGE) break
  }

  // Test accounts are left out of every report
  const testIds = await loadTestStoreIds(supabase)
  const live = raw.filter((r) => !isTestStore(testIds, r.store_id))

  // Login names for admin-keyed sales
  const recorderIds = Array.from(new Set(live.filter((r) => !r.store_staff_id && r.recorded_by).map((r) => r.recorded_by as string)))
  const recorderNames = new Map<string, string>()
  if (recorderIds.length > 0) {
    const { data: profiles } = await createAdminClient()
      .from('profiles')
      .select('id, full_name')
      .in('id', recorderIds)
    for (const p of profiles ?? []) recorderNames.set(p.id, p.full_name)
  }

  const sales: SaleForStaffReport[] = live.map((r) => ({
    store_id: r.store_id,
    store_code: r.stores?.store_code ?? '',
    store_name: r.stores?.store_name ?? 'Unknown store',
    quantity: r.quantity,
    total_amount: r.total_amount,
    store_staff_id: r.store_staff_id,
    staff_name: r.staff?.name ?? null,
    recorded_by: r.recorded_by,
    recorder_name: r.recorded_by ? recorderNames.get(r.recorded_by) ?? null : null,
  }))

  return Response.json({ month, store_id: storeId, stores: buildSalesByStaff(sales) })
}
