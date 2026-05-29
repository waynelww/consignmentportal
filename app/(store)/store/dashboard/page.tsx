'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { RefreshCw, Pencil, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, timeAgo, formatMYDate } from '@/lib/utils'
import type { Sale } from '@/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/components/store/StoreContext'

interface DashboardData {
  todaySales: number
  todayRevenue: number
  todayCommission: number
  monthSales: number
  monthRevenue: number
  monthCommission: number
  lastMonthSales: number
  lastMonthRevenue: number
  lastMonthCommission: number
  recentSales: Sale[]
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-2/3 mb-3" />
      <div className="h-7 bg-gray-200 rounded w-1/2" />
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
          <div className="flex justify-between">
            <div className="h-4 bg-gray-200 rounded w-2/5" />
            <div className="h-4 bg-gray-200 rounded w-1/4" />
          </div>
          <div className="h-3 bg-gray-200 rounded w-1/3 mt-2" />
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { storeId } = useStore()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // Edit modal state
  const [editingSale, setEditingSale] = useState<Sale | null>(null)
  const [editQty, setEditQty] = useState(1)
  const [editSubmitting, setEditSubmitting] = useState(false)

  const loadDashboard = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    const supabase = createClient()

    const myNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
    const pad = (n: number) => String(n).padStart(2, '0')
    const y = myNow.getFullYear()
    const m = myNow.getMonth() + 1
    const todayStr = `${y}-${pad(m)}-${pad(myNow.getDate())}`
    const firstOfMonth = `${y}-${pad(m)}-01`

    // Previous month bounds
    const prevMonthYear = m === 1 ? y - 1 : y
    const prevMonth = m === 1 ? 12 : m - 1
    const firstOfPrevMonth = `${prevMonthYear}-${pad(prevMonth)}-01`
    // Last day of prev month = day 0 of current month
    const lastOfPrevMonthDate = new Date(y, m - 1, 0)
    const lastOfPrevMonth = `${lastOfPrevMonthDate.getFullYear()}-${pad(lastOfPrevMonthDate.getMonth() + 1)}-${pad(lastOfPrevMonthDate.getDate())}`

    const [todaySalesRes, monthSalesRes, lastMonthSalesRes, recentSalesRes] = await Promise.all([
      supabase
        .from('sales')
        .select('quantity, total_amount, commission_amount')
        .eq('store_id', storeId)
        .eq('sale_date', todayStr),
      supabase
        .from('sales')
        .select('quantity, total_amount, commission_amount')
        .eq('store_id', storeId)
        .gte('sale_date', firstOfMonth)
        .lte('sale_date', todayStr),
      supabase
        .from('sales')
        .select('quantity, total_amount, commission_amount')
        .eq('store_id', storeId)
        .gte('sale_date', firstOfPrevMonth)
        .lte('sale_date', lastOfPrevMonth),
      supabase
        .from('sales')
        .select('*, product:products(*)')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(8),
    ])

    type SaleTotals = { quantity: number; total_amount: number; commission_amount: number }
    const todayArr = (todaySalesRes.data ?? []) as SaleTotals[]
    const monthArr = (monthSalesRes.data ?? []) as SaleTotals[]
    const lastMonthArr = (lastMonthSalesRes.data ?? []) as SaleTotals[]
    const recentSales = (recentSalesRes.data as Sale[]) ?? []

    setData({
      todaySales: todayArr.reduce((s, x) => s + x.quantity, 0),
      todayRevenue: todayArr.reduce((s, x) => s + x.total_amount, 0),
      todayCommission: todayArr.reduce((s, x) => s + x.commission_amount, 0),
      monthSales: monthArr.reduce((s, x) => s + x.quantity, 0),
      monthRevenue: monthArr.reduce((s, x) => s + x.total_amount, 0),
      monthCommission: monthArr.reduce((s, x) => s + x.commission_amount, 0),
      lastMonthSales: lastMonthArr.reduce((s, x) => s + x.quantity, 0),
      lastMonthRevenue: lastMonthArr.reduce((s, x) => s + x.total_amount, 0),
      lastMonthCommission: lastMonthArr.reduce((s, x) => s + x.commission_amount, 0),
      recentSales,
    })
    setLoading(false)
  }, [storeId])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  function openEdit(sale: Sale) {
    setEditingSale(sale)
    setEditQty(sale.quantity)
  }

  async function submitEdit() {
    if (!editingSale) return
    setEditSubmitting(true)
    try {
      const res = await fetch(`/api/sales/${editingSale.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: editQty }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? 'Failed to update sale')
      }
      toast.success('Sale updated')
      setEditingSale(null)
      loadDashboard()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update sale'
      toast.error(message)
    } finally {
      setEditSubmitting(false)
    }
  }

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
  const monthName = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' })
  const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('en-MY', { month: 'long', year: 'numeric' })

  return (
    <div className="px-4 py-5 space-y-6 max-w-lg mx-auto">
      {/* Today */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Today</h2>
          <button onClick={loadDashboard} className="p-1 text-gray-400 hover:text-gray-600">
            <RefreshCw size={14} />
          </button>
        </div>
        {loading ? (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x">
            {[1, 2, 3].map((i) => <div key={i} className="min-w-[140px] snap-start"><SkeletonCard /></div>)}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x">
            <SummaryCard label="Pairs Sold" value={String(data?.todaySales ?? 0)} unit="pairs" accent />
            <SummaryCard label="Revenue" value={formatCurrency(data?.todayRevenue ?? 0)} />
            <SummaryCard label="Commission" value={formatCurrency(data?.todayCommission ?? 0)} success />
          </div>
        )}
      </section>

      {/* This month */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{monthName}</h2>
        {loading ? (
          <SkeletonCard />
        ) : (
          <div className="bg-[#0A0A0A] rounded-xl p-5">
            <p className="text-xs text-gray-400 mb-0.5">Earnings this month</p>
            <p className="text-4xl font-bold text-[#FFD700] mt-1">{formatCurrency(data?.monthCommission ?? 0)}</p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-gray-400">Pairs</p>
                <p className="text-lg font-bold text-white">{data?.monthSales ?? 0}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Revenue</p>
                <p className="text-sm font-bold text-white">{formatCurrency(data?.monthRevenue ?? 0)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400">Commission</p>
                <p className="text-sm font-bold text-[#22C55E]">{formatCurrency(data?.monthCommission ?? 0)}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Last month */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{lastMonthName}</h2>
        {loading ? (
          <SkeletonCard />
        ) : (
          <div className="bg-white rounded-xl shadow-sm p-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-gray-500">Pairs</p>
              <p className="text-xl font-bold text-[#0A0A0A]">{data?.lastMonthSales ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Revenue</p>
              <p className="text-sm font-bold text-[#0A0A0A]">{formatCurrency(data?.lastMonthRevenue ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Commission</p>
              <p className="text-sm font-bold text-[#22C55E]">{formatCurrency(data?.lastMonthCommission ?? 0)}</p>
            </div>
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section className="space-y-3">
        <Link
          href="/store/record-sale"
          className="block w-full h-14 bg-[#0A0A0A] text-[#FFD700] rounded-xl font-semibold text-base text-center leading-[56px] shadow-sm hover:opacity-90 transition-opacity"
        >
          Record a Sale
        </Link>
        <Link
          href="/store/restock-request"
          className="block w-full h-14 bg-white border-2 border-[#0A0A0A] text-[#0A0A0A] rounded-xl font-semibold text-base text-center leading-[52px] shadow-sm hover:bg-gray-50 transition-colors"
        >
          Request Restock
        </Link>
      </section>

      {/* Recent transactions (with edit) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Recent Transactions</h2>
          <Link href="/store/sales-history" className="text-xs text-[#0A0A0A] font-medium underline">
            View All
          </Link>
        </div>
        {loading ? (
          <SkeletonList />
        ) : (
          <div className="space-y-2">
            {(data?.recentSales ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No sales recorded yet.</p>
            ) : (
              (data?.recentSales ?? []).map((sale) => (
                <div key={sale.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0A0A0A] truncate">
                      {sale.product?.name ?? 'Unknown Product'}
                    </p>
                    <p className="text-xs text-gray-400">{timeAgo(sale.created_at)} · Qty {sale.quantity}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-[#0A0A0A]">{formatCurrency(sale.total_amount)}</p>
                  </div>
                  <button
                    onClick={() => openEdit(sale)}
                    className="flex items-center gap-1 px-2.5 h-8 rounded-lg bg-[#FFD700] text-[#0A0A0A] text-xs font-bold shrink-0"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Edit modal */}
      {editingSale && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !editSubmitting && setEditingSale(null)} />
          <div className="relative bg-white rounded-t-2xl w-full max-w-lg px-5 pt-5 pb-8 shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[#0A0A0A]">Edit Sale</h3>
              <button
                onClick={() => !editSubmitting && setEditingSale(null)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 mb-4">
              <p className="text-sm font-bold text-[#0A0A0A]">{editingSale.product?.name}</p>
              <p className="text-xs text-gray-400 font-mono">{editingSale.product?.sku}</p>
              <p className="text-xs text-gray-400 mt-1">
                {formatMYDate(editingSale.sale_date)} · {formatCurrency(editingSale.unit_price)} / pair
              </p>
            </div>
            <p className="text-sm font-medium text-gray-600 mb-3">New quantity</p>
            <div className="flex items-center justify-center gap-6 mb-5">
              <button
                onClick={() => setEditQty((q) => Math.max(1, q - 1))}
                disabled={editSubmitting}
                className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors active:scale-95 disabled:opacity-40"
              >
                <span className="text-xl font-bold">−</span>
              </button>
              <span className="text-5xl font-bold text-[#0A0A0A] min-w-[3rem] text-center">{editQty}</span>
              <button
                onClick={() => setEditQty((q) => q + 1)}
                disabled={editSubmitting}
                className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors active:scale-95 disabled:opacity-40"
              >
                <span className="text-xl font-bold">+</span>
              </button>
            </div>
            {editQty !== editingSale.quantity && (
              <p className="text-xs text-center text-amber-600 mb-3">
                {editQty > editingSale.quantity
                  ? `+${editQty - editingSale.quantity} pairs will be deducted from stock`
                  : `${editingSale.quantity - editQty} pairs will be returned to stock`}
              </p>
            )}
            <button
              onClick={submitEdit}
              disabled={editSubmitting || editQty === editingSale.quantity}
              className={cn(
                'w-full h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-bold text-base flex items-center justify-center gap-2',
                (editSubmitting || editQty === editingSale.quantity)
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:opacity-90 active:scale-95 transition-all',
              )}
            >
              {editSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  unit,
  accent,
  success,
}: {
  label: string
  value: string
  unit?: string
  accent?: boolean
  success?: boolean
}) {
  return (
    <div className="min-w-[140px] snap-start bg-white rounded-xl shadow-sm p-4 flex-shrink-0">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p
        className={cn(
          'text-xl font-bold leading-tight',
          accent && 'text-[#FFD700]',
          success && 'text-[#22C55E]',
          !accent && !success && 'text-[#0A0A0A]',
        )}
      >
        {value}
      </p>
      {unit && <p className="text-xs text-gray-400 mt-0.5">{unit}</p>}
    </div>
  )
}
