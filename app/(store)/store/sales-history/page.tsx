'use client'

import { useEffect, useState, useMemo } from 'react'
import { Download, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMYDate } from '@/lib/utils'
import type { Sale, Product, Profile } from '@/types'
import { cn } from '@/lib/utils'

type QuickFilter = 'today' | 'week' | 'month' | 'custom'
type PaymentFilter = 'all' | 'qr' | 'cash'

function getMYNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
}

function getDateRange(quick: QuickFilter, customFrom: string, customTo: string): { from: string; to: string } {
  const now = getMYNow()
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  if (quick === 'today') {
    return { from: today, to: today }
  }
  if (quick === 'week') {
    const day = now.getDay()
    const diff = day === 0 ? 6 : day - 1 // Monday start
    const monday = new Date(now)
    monday.setDate(now.getDate() - diff)
    const fromStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
    return { from: fromStr, to: today }
  }
  if (quick === 'month') {
    const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
    return { from, to: today }
  }
  return { from: customFrom, to: customTo }
}

export default function SalesHistoryPage() {
  const [allSales, setAllSales] = useState<Sale[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const [quickFilter, setQuickFilter] = useState<QuickFilter>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [productFilter, setProductFilter] = useState<string>('all')
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('store_id')
        .eq('id', user.id)
        .single<Profile>()

      if (!profile?.store_id) { setLoading(false); return }

      const { data: salesData } = await supabase
        .from('sales')
        .select('*, product:products(*)')
        .eq('store_id', profile.store_id)
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false })

      const sales = (salesData as Sale[]) ?? []
      setAllSales(sales)

      // Extract unique products from sales
      const productMap = new Map<string, Product>()
      for (const s of sales) {
        if (s.product && !productMap.has(s.product_id)) {
          productMap.set(s.product_id, s.product)
        }
      }
      setProducts(Array.from(productMap.values()))
      setLoading(false)
    }
    load()
  }, [])

  const { from, to } = getDateRange(quickFilter, customFrom, customTo)

  const filtered = useMemo(() => {
    return allSales.filter((sale) => {
      const saleDate = sale.sale_date?.slice(0, 10) ?? ''
      if (from && saleDate < from) return false
      if (to && saleDate > to) return false
      if (productFilter !== 'all' && sale.product_id !== productFilter) return false
      if (paymentFilter !== 'all' && sale.payment_method !== paymentFilter) return false
      return true
    })
  }, [allSales, from, to, productFilter, paymentFilter])

  const summary = useMemo(() => ({
    pairs: filtered.reduce((s, x) => s + x.quantity, 0),
    revenue: filtered.reduce((s, x) => s + x.total_amount, 0),
    commission: filtered.reduce((s, x) => s + x.commission_amount, 0),
  }), [filtered])

  function downloadCSV() {
    const header = ['Date', 'Time', 'Product', 'SKU', 'Qty', 'Unit Price', 'Total', 'Commission', 'Payment', 'QR Ref']
    const rows = filtered.map((s) => {
      const d = new Date(s.created_at)
      const dateStr = formatMYDate(s.created_at)
      const timeStr = d.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })
      return [
        dateStr,
        timeStr,
        s.product?.name ?? '',
        s.product?.sku ?? '',
        String(s.quantity),
        s.unit_price.toFixed(2),
        s.total_amount.toFixed(2),
        s.commission_amount.toFixed(2),
        s.payment_method,
        s.qr_reference ?? '',
      ]
    })

    const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const quickTabs: { key: QuickFilter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'custom', label: 'Custom' },
  ]

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#0A0A0A]">Sales History</h1>
        <button
          onClick={downloadCSV}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#0A0A0A] bg-[#FFD700] px-3 py-2 rounded-lg disabled:opacity-40"
        >
          <Download size={14} />
          CSV
        </button>
      </div>

      {/* Quick date filters */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-4 px-4">
        {quickTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setQuickFilter(t.key)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
              quickFilter === t.key
                ? 'bg-[#0A0A0A] text-[#FFD700]'
                : 'bg-white text-gray-600 border border-gray-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {quickFilter === 'custom' && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">From</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">To</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            />
          </div>
        </div>
      )}

      {/* Product + payment filters */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="w-full h-10 pl-3 pr-8 rounded-xl border border-gray-200 text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          >
            <option value="all">All Products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
            className="h-10 pl-3 pr-8 rounded-xl border border-gray-200 text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          >
            <option value="all">All</option>
            <option value="qr">QR</option>
            <option value="cash">Cash</option>
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Summary */}
      {!loading && (
        <div className="bg-[#0A0A0A] rounded-xl p-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-gray-400">Pairs</p>
            <p className="text-xl font-bold text-[#FFD700]">{summary.pairs}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Revenue</p>
            <p className="text-sm font-bold text-white">{formatCurrency(summary.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Commission</p>
            <p className="text-sm font-bold text-[#22C55E]">{formatCurrency(summary.commission)}</p>
          </div>
        </div>
      )}

      {/* Sales list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="flex justify-between">
                <div className="h-4 bg-gray-200 rounded w-2/5" />
                <div className="h-4 bg-gray-200 rounded w-1/4" />
              </div>
              <div className="h-3 bg-gray-200 rounded w-1/3 mt-2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No sales for this period.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((sale) => {
            const d = new Date(sale.created_at)
            const timeStr = d.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })
            return (
              <div key={sale.id} className="bg-white rounded-xl shadow-sm px-4 py-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0A0A0A] truncate">
                      {sale.product?.name ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatMYDate(sale.sale_date)} · {timeStr} · Qty {sale.quantity}
                    </p>
                    {sale.qr_reference && (
                      <p className="text-xs font-mono text-gray-400 mt-0.5">Ref: {sale.qr_reference}</p>
                    )}
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className="text-sm font-bold text-[#0A0A0A]">{formatCurrency(sale.total_amount)}</p>
                    <span
                      className={cn(
                        'inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                        sale.payment_method === 'qr'
                          ? 'bg-teal-100 text-teal-700'
                          : 'bg-gray-100 text-gray-600',
                      )}
                    >
                      {sale.payment_method === 'qr' ? 'QR' : 'Cash'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
