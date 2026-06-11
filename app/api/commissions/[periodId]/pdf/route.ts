import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateStatementPdf } from '@/lib/pdf/generate-statement'

const BUCKET = 'commission-pdfs'

const MONTH_ABBRS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ periodId: string }> }
) {
  const inline = _request.nextUrl.searchParams.has('inline')
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

  // ── Fetch commission period with store ───────────────────────────────────────
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
        commission_rate
      )
    `)
    .eq('id', periodId)
    .single()

  if (periodErr || !period) {
    return Response.json({ error: 'Commission period not found' }, { status: 404 })
  }

  // ── Authorization ─────────────────────────────────────────────────────────────
  if (profile.role === 'store_owner') {
    if (period.store_id !== profile.store_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const store = period.stores as {
    store_name: string
    store_code: string
    pic_name: string
    email: string | null
    address: string | null
    city: string | null
    state: string | null
    commission_rate: number
  } | null

  if (!store) return Response.json({ error: 'Store data not found' }, { status: 500 })

  const svc = await createServiceClient()
  const storagePath = `${store.store_code}/${periodId}.pdf`
  const monthAbbr = MONTH_ABBRS[(period.period_month as number) - 1]
  const year2 = String(period.period_year).slice(-2)
  const safeStoreName = store.store_name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  const filename = `${monthAbbr}${year2}-${safeStoreName}-${store.store_code}.pdf`
  const disposition = inline ? 'inline' : 'attachment'

  // ── If already stored, serve from storage ────────────────────────────────────
  if (period.pdf_url) {
    const { data: fileData, error: dlErr } = await svc.storage
      .from(BUCKET)
      .download(storagePath)

    if (!dlErr && fileData) {
      const arrayBuf = await fileData.arrayBuffer()
      return new Response(Buffer.from(arrayBuf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${disposition}; filename="${filename}"`,
          'Content-Length': String(arrayBuf.byteLength),
        },
      })
    }
    // Storage fetch failed — fall through to regenerate
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
  const endYear  = period.period_month === 12 ? period.period_year + 1 : period.period_year
  const endMonth = period.period_month === 12 ? 1 : period.period_month + 1
  const endDate  = `${endYear}-${String(endMonth).padStart(2, '0')}-01`

  const { data: sales, error: salesErr } = await supabase
    .from('sales')
    .select(`quantity, unit_price, total_amount, commission_amount, products:product_id(name, sku)`)
    .eq('store_id', period.store_id)
    .gte('sale_date', startDate)
    .lt('sale_date', endDate)

  if (salesErr) {
    return Response.json({ error: 'Failed to fetch sales', details: salesErr.message }, { status: 500 })
  }

  // ── Aggregate by product ──────────────────────────────────────────────────────
  type SaleRaw = {
    quantity: number; unit_price: number; total_amount: number
    commission_amount: number; products: { name: string; sku: string } | null
  }

  const productMap = new Map<string, {
    productName: string; sku: string; unitsSold: number
    unitPrice: number; revenue: number; commission: number
  }>()

  for (const sale of (sales as unknown as SaleRaw[]) ?? []) {
    const sku = sale.products?.sku ?? 'UNKNOWN'
    const ex = productMap.get(sku)
    if (ex) {
      ex.unitsSold  += sale.quantity
      ex.revenue    += sale.total_amount
      ex.commission += sale.commission_amount
    } else {
      productMap.set(sku, {
        productName: sale.products?.name ?? 'Unknown Product',
        sku, unitsSold: sale.quantity, unitPrice: sale.unit_price,
        revenue: sale.total_amount, commission: sale.commission_amount,
      })
    }
  }

  // ── payment_terms_days — resilient separate query ─────────────────────────────
  let paymentTermsDays = 7
  const { data: termsData } = await supabase
    .from('stores').select('payment_terms_days').eq('id', period.store_id).single()
  if (termsData && typeof (termsData as Record<string, unknown>).payment_terms_days === 'number') {
    paymentTermsDays = (termsData as Record<string, unknown>).payment_terms_days as number
  }

  // ── Generate PDF ──────────────────────────────────────────────────────────────
  const generatedDate = new Date().toLocaleDateString('en-MY', { day: '2-digit', month: 'long', year: 'numeric' })
  const paidAt = period.paid_at
    ? new Date(period.paid_at).toLocaleDateString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : undefined

  const addressParts = [store.address, store.city, store.state].filter(Boolean)

  const pdfBytes = await generateStatementPdf({
    storeName: store.store_name,
    storeCode: store.store_code,
    picName: store.pic_name,
    storeAddress: addressParts.length > 0 ? addressParts.join(', ') : undefined,
    periodMonth: period.period_month,
    periodYear: period.period_year,
    generatedDate,
    commissionRate: store.commission_rate ?? 30,
    paymentTermsDays,
    companyName: settingsMap['company_name'],
    companyAddress: settingsMap['company_address'],
    companyContact: settingsMap['company_contact'],
    items: Array.from(productMap.values()),
    totalUnits: period.total_units_sold,
    totalRevenue: period.total_revenue,
    totalCommission: period.commission_amount,
    xocksRevenue: period.xocks_revenue,
    status: period.status,
    paymentReference: period.payment_reference ?? undefined,
    paidAt,
  })

  // ── Upload to storage (fire-and-forget, don't block the response) ─────────────
  ;(async () => {
    try {
      // Ensure bucket exists
      await svc.storage.createBucket(BUCKET, { public: false }).catch(() => {/* already exists */})

      const { error: upErr } = await svc.storage
        .from(BUCKET)
        .upload(storagePath, Buffer.from(pdfBytes), {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (!upErr) {
        // Record the storage path so future requests serve from storage
        await svc
          .from('commission_periods')
          .update({ pdf_url: storagePath })
          .eq('id', periodId)
      }
    } catch (err) {
      console.error('[pdf] storage upload failed:', err)
    }
  })()

  return new Response(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Content-Length': String(pdfBytes.length),
    },
  })
}
