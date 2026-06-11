/**
 * GET /api/admin/export?type=sales|commissions|stores|products[&month=YYYY-MM]
 * Streams a CSV download. Admin only. Reads use the user-scoped client —
 * RLS already grants super_admin/ops_manager full SELECT on these tables.
 *
 * `month` (sales only) filters by sale_date within that calendar month;
 * omit it to export everything.
 */
import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PAGE = 1000

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  // Neutralize formula injection (CWE-1236): Excel/Sheets evaluate cells that
  // start with = + - @ tab CR as formulas even when double-quoted in CSV.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map(csvEscape).join(',')]
  for (const r of rows) lines.push(columns.map((c) => csvEscape(r[c])).join(','))
  return lines.join('\n')
}

function csvResponse(csv: string, filename: string): Response {
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const type = searchParams.get('type') ?? 'sales'
  const month = searchParams.get('month') // YYYY-MM

  if (type === 'sales') {
    let monthSuffix = 'all-time'
    const rows: Record<string, unknown>[] = []
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from('sales')
        .select('*, store:stores(store_code, store_name), product:products(sku, name)')
        .order('sale_date', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1)

      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split('-').map(Number)
        const lastDay = new Date(y, m, 0).getDate()
        q = q.gte('sale_date', `${month}-01`).lte('sale_date', `${month}-${String(lastDay).padStart(2, '0')}`)
        monthSuffix = month
      }

      const { data, error } = await q
      if (error) return Response.json({ error: error.message }, { status: 500 })
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const store = r.store as { store_code?: string; store_name?: string } | null
        const product = r.product as { sku?: string; name?: string } | null
        rows.push({
          sale_date: r.sale_date,
          store_code: store?.store_code,
          store_name: store?.store_name,
          sku: product?.sku,
          product_name: product?.name,
          quantity: r.quantity,
          unit_price: r.unit_price,
          total_amount: r.total_amount,
          commission_amount: r.commission_amount,
          xocks_revenue: r.xocks_revenue,
          payment_method: r.payment_method,
          qr_reference: r.qr_reference,
          promo_discount: r.promo_discount,
          sale_group_id: r.sale_group_id,
          recorded_at: r.created_at,
          id: r.id,
        })
      }
      if (!data || data.length < PAGE) break
    }
    const cols = ['sale_date', 'store_code', 'store_name', 'sku', 'product_name', 'quantity', 'unit_price',
      'total_amount', 'commission_amount', 'xocks_revenue', 'payment_method', 'qr_reference',
      'promo_discount', 'sale_group_id', 'recorded_at', 'id']
    return csvResponse(toCsv(rows, cols), `xcms-sales-${monthSuffix}.csv`)
  }

  if (type === 'commissions') {
    const { data, error } = await supabase
      .from('commission_periods')
      .select('*, store:stores(store_code, store_name), receipt:payment_receipts(status, bank_reference, created_at)')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
      const store = r.store as { store_code?: string; store_name?: string } | null
      const rcptRaw = r.receipt
      const rcpt = (Array.isArray(rcptRaw) ? rcptRaw[0] : rcptRaw) as { status?: string; bank_reference?: string; created_at?: string } | null
      return {
        period: `${r.period_year}-${String(r.period_month).padStart(2, '0')}`,
        store_code: store?.store_code,
        store_name: store?.store_name,
        total_units_sold: r.total_units_sold,
        total_revenue: r.total_revenue,
        store_commission: r.commission_amount,
        amount_due_to_xocks: r.xocks_revenue,
        status: r.status,
        paid_at: r.paid_at,
        payment_reference: r.payment_reference,
        receipt_status: rcpt?.status,
        receipt_bank_reference: rcpt?.bank_reference,
        receipt_uploaded_at: rcpt?.created_at,
        id: r.id,
      }
    })
    const cols = ['period', 'store_code', 'store_name', 'total_units_sold', 'total_revenue', 'store_commission',
      'amount_due_to_xocks', 'status', 'paid_at', 'payment_reference', 'receipt_status',
      'receipt_bank_reference', 'receipt_uploaded_at', 'id']
    return csvResponse(toCsv(rows, cols), 'xcms-commission-summary.csv')
  }

  if (type === 'stores') {
    const { data, error } = await supabase.from('stores').select('*').order('store_code')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as Record<string, unknown>[]
    const cols = rows.length ? Object.keys(rows[0]) : ['id']
    return csvResponse(toCsv(rows, cols), 'xcms-stores.csv')
  }

  if (type === 'products') {
    const { data, error } = await supabase.from('products').select('*').order('sku')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as Record<string, unknown>[]
    const cols = rows.length ? Object.keys(rows[0]) : ['id']
    return csvResponse(toCsv(rows, cols), 'xcms-products.csv')
  }

  return Response.json({ error: `Unknown export type: ${type}` }, { status: 400 })
}
