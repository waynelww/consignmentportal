import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { cachedAdminJson } from '@/lib/cache'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/bot/commission-overview?status=pending|approved|paid|disputed (optional)
// Returns commission periods grouped by status, plus per-store outstanding totals.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const statusFilter = request.nextUrl.searchParams.get('status')
  const supabase = createAdminClient()

  let query = supabase
    .from('commission_periods')
    .select(`
      id,
      period_month,
      period_year,
      total_units_sold,
      total_revenue,
      commission_amount,
      xocks_revenue,
      status,
      approved_at,
      paid_at,
      stores:store_id ( id, store_code, store_name, store_type )
    `)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })

  if (statusFilter) query = query.eq('status', statusFilter)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = data ?? []

  const byStatus: Record<string, { count: number; total_commission_rm: number; total_units: number }> = {}
  const outstandingByStore: Record<string, { store_name: string; store_code: string; periods: number; commission_owed_rm: number }> = {}

  for (const r of rows) {
    const status = r.status
    if (!byStatus[status]) byStatus[status] = { count: 0, total_commission_rm: 0, total_units: 0 }
    byStatus[status].count += 1
    byStatus[status].total_commission_rm += Number(r.commission_amount)
    byStatus[status].total_units += r.total_units_sold

    if (status === 'pending' || status === 'approved') {
      const s = r.stores as { id?: string; store_code?: string; store_name?: string } | null
      const key = s?.id ?? 'unknown'
      if (!outstandingByStore[key]) {
        outstandingByStore[key] = {
          store_name: s?.store_name ?? 'Unknown',
          store_code: s?.store_code ?? '—',
          periods: 0,
          commission_owed_rm: 0,
        }
      }
      outstandingByStore[key].periods += 1
      outstandingByStore[key].commission_owed_rm += Number(r.commission_amount)
    }
  }

  for (const k of Object.keys(byStatus)) {
    byStatus[k].total_commission_rm = round(byStatus[k].total_commission_rm)
  }
  for (const k of Object.keys(outstandingByStore)) {
    outstandingByStore[k].commission_owed_rm = round(outstandingByStore[k].commission_owed_rm)
  }

  return cachedAdminJson({
    by_status: byStatus,
    outstanding_by_store: Object.values(outstandingByStore).sort((a, b) => b.commission_owed_rm - a.commission_owed_rm),
    periods: rows,
  })
}

function round(n: number) {
  return Math.round(n * 100) / 100
}
