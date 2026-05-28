import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/bot/sales-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=store|sku|store_type|state
// Returns aggregated sales totals + grouped breakdowns for the date range.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const { searchParams } = request.nextUrl
  const from = searchParams.get('from') ?? defaultFrom()
  const to = searchParams.get('to') ?? today()
  const groupBy = (searchParams.get('groupBy') ?? 'store') as 'store' | 'sku' | 'store_type' | 'state'

  const supabase = createAdminClient()

  const { data: sales, error } = await supabase
    .from('sales')
    .select(`
      quantity,
      total_amount,
      commission_amount,
      xocks_revenue,
      sale_date,
      stores:store_id ( id, store_name, store_code, store_type, state, city ),
      products:product_id ( id, sku, name, category )
    `)
    .gte('sale_date', from)
    .lte('sale_date', to)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = sales ?? []

  const totals = rows.reduce(
    (acc, r) => {
      acc.units += r.quantity
      acc.gross += Number(r.total_amount)
      acc.commission += Number(r.commission_amount)
      acc.xocks_revenue += Number(r.xocks_revenue)
      acc.transactions += 1
      return acc
    },
    { units: 0, gross: 0, commission: 0, xocks_revenue: 0, transactions: 0 },
  )

  const grouped: Record<string, { label: string; units: number; revenue: number; xocks_revenue: number; transactions: number }> = {}
  for (const r of rows) {
    const store = r.stores as { id?: string; store_name?: string; store_code?: string; store_type?: string; state?: string } | null
    const product = r.products as { id?: string; sku?: string; name?: string; category?: string } | null
    let key = 'unknown'
    let label = 'Unknown'
    if (groupBy === 'store') {
      key = store?.id ?? 'unknown'
      label = store?.store_name ?? 'Unknown'
    } else if (groupBy === 'sku') {
      key = product?.id ?? 'unknown'
      label = product?.name ?? product?.sku ?? 'Unknown'
    } else if (groupBy === 'store_type') {
      key = store?.store_type ?? 'unknown'
      label = store?.store_type ?? 'Unknown'
    } else if (groupBy === 'state') {
      key = store?.state ?? 'unknown'
      label = store?.state ?? 'Unknown'
    }

    if (!grouped[key]) {
      grouped[key] = { label, units: 0, revenue: 0, xocks_revenue: 0, transactions: 0 }
    }
    grouped[key].units += r.quantity
    grouped[key].revenue += Number(r.total_amount)
    grouped[key].xocks_revenue += Number(r.xocks_revenue)
    grouped[key].transactions += 1
  }

  const breakdown = Object.entries(grouped)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.revenue - a.revenue)

  return Response.json({
    period: { from, to },
    groupBy,
    totals: {
      units_sold: totals.units,
      gross_sales_rm: round(totals.gross),
      commission_paid_rm: round(totals.commission),
      xocks_revenue_rm: round(totals.xocks_revenue),
      transactions: totals.transactions,
    },
    breakdown,
  })
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function defaultFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

function round(n: number) {
  return Math.round(n * 100) / 100
}
