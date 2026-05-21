import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateStatementPdf } from '@/lib/pdf/generate-statement'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ periodId: string }> }
) {
  const { periodId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  // ── Fetch commission period with store ────────────────────────────────────────
  const { data: period, error: periodErr } = await supabase
    .from('commission_periods')
    .select(`
      *,
      stores:store_id (
        store_name,
        store_code,
        pic_name,
        email,
        address,
        city,
        state,
        commission_rate,
        payment_terms_days
      )
    `)
    .eq('id', periodId)
    .single()

  if (periodErr || !period) {
    return Response.json({ error: 'Commission period not found' }, { status: 404 })
  }

  // ── Authorization ────────────────────────────────────────────────────────────
  if (profile.role === 'store_owner') {
    if (period.store_id !== profile.store_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Fetch company settings ────────────────────────────────────────────────────
  const { data: settingsRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['company_name', 'company_address', 'company_contact'])

  const settingsMap: Record<string, string> = {}
  for (const row of settingsRows ?? []) settingsMap[row.key] = row.value

  // ── Fetch sales for this period ───────────────────────────────────────────────
  const startDate = `${period.period_year}-${String(period.period_month).padStart(2, '0')}-01`
  const endYear = period.period_month === 12 ? period.period_year + 1 : period.period_year
  const endMonth = period.period_month === 12 ? 1 : period.period_month + 1
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`

  const { data: sales, error: salesErr } = await supabase
    .from('sales')
    .select(`
      quantity,
      unit_price,
      total_amount,
      commission_amount,
      products:product_id (
        name,
        sku
      )
    `)
    .eq('store_id', period.store_id)
    .gte('sale_date', startDate)
    .lt('sale_date', endDate)

  if (salesErr) {
    return Response.json({ error: 'Failed to fetch sales', details: salesErr.message }, { status: 500 })
  }

  // ── Aggregate sales by product ────────────────────────────────────────────────
  type SaleRaw = {
    quantity: number
    unit_price: number
    total_amount: number
    commission_amount: number
    products: { name: string; sku: string } | null
  }

  const productMap = new Map<string, {
    productName: string
    sku: string
    unitsSold: number
    unitPrice: number
    revenue: number
    commission: number
  }>()

  for (const sale of (sales as unknown as SaleRaw[]) ?? []) {
    const sku = sale.products?.sku ?? 'UNKNOWN'
    const existing = productMap.get(sku)
    if (existing) {
      existing.unitsSold += sale.quantity
      existing.revenue += sale.total_amount
      existing.commission += sale.commission_amount
    } else {
      productMap.set(sku, {
        productName: sale.products?.name ?? 'Unknown Product',
        sku,
        unitsSold: sale.quantity,
        unitPrice: sale.unit_price,
        revenue: sale.total_amount,
        commission: sale.commission_amount,
      })
    }
  }

  const items = Array.from(productMap.values())

  // ── Build store info ──────────────────────────────────────────────────────────
  const store = period.stores as {
    store_name: string
    store_code: string
    pic_name: string
    email: string | null
    address: string | null
    city: string | null
    state: string | null
    commission_rate: number
    payment_terms_days: number | null
  } | null

  if (!store) {
    return Response.json({ error: 'Store data not found' }, { status: 500 })
  }

  // ── Generate PDF ─────────────────────────────────────────────────────────────
  const generatedDate = new Date().toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  const paidAt = period.paid_at
    ? new Date(period.paid_at).toLocaleDateString('en-MY', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : undefined

  // Build store address string
  const addressParts = [store.address, store.city, store.state].filter(Boolean)
  const storeAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined

  const pdfBytes = await generateStatementPdf({
    storeName: store.store_name,
    storeCode: store.store_code,
    picName: store.pic_name,
    storeAddress,
    periodMonth: period.period_month,
    periodYear: period.period_year,
    generatedDate,
    commissionRate: store.commission_rate ?? 30,
    paymentTermsDays: store.payment_terms_days ?? 7,
    companyName: settingsMap['company_name'],
    companyAddress: settingsMap['company_address'],
    companyContact: settingsMap['company_contact'],
    items,
    totalUnits: period.total_units_sold,
    totalRevenue: period.total_revenue,
    totalCommission: period.commission_amount,
    xocksRevenue: period.xocks_revenue,
    status: period.status,
    paymentReference: period.payment_reference ?? undefined,
    paidAt,
  })

  const monthName = MONTH_NAMES[(period.period_month as number) - 1]
  const filename = `Statement-${store.store_code}-${monthName}-${period.period_year}.pdf`

  return new Response(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBytes.length),
    },
  })
}
