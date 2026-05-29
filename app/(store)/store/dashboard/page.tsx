'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { RefreshCw, Pencil, X, Loader2, BookOpen, Trash2, ChevronRight } from 'lucide-react'
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

  // Edit modal state — supports either a single sale OR a transaction group of sales
  const [editingGroup, setEditingGroup] = useState<Sale[] | null>(null)
  // Each row's working quantity in the modal (keyed by sale id)
  const [editQuantities, setEditQuantities] = useState<Record<string, number>>({})
  // Sales the user marked for removal (qty -> 0)
  const [removedSaleIds, setRemovedSaleIds] = useState<Set<string>>(new Set())
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
      // Fetch a larger window so that multi-item transactions aren't truncated by limit
      supabase
        .from('sales')
        .select('*, product:products(*)')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(40),
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

  // Group consecutive sales by sale_group_id; standalone sales are their own group
  const groupedTransactions = (() => {
    const sales = data?.recentSales ?? []
    const groups: { key: string; sales: Sale[] }[] = []
    const groupIndex = new Map<string, number>()

    for (const sale of sales) {
      const key = sale.sale_group_id || sale.id // fallback: single-sale "group"
      if (groupIndex.has(key)) {
        groups[groupIndex.get(key)!].sales.push(sale)
      } else {
        groupIndex.set(key, groups.length)
        groups.push({ key, sales: [sale] })
      }
    }
    return groups.slice(0, 8) // show up to 8 transactions
  })()

  function openEdit(group: Sale[]) {
    setEditingGroup(group)
    setEditQuantities(Object.fromEntries(group.map((s) => [s.id, s.quantity])))
    setRemovedSaleIds(new Set())
  }

  function closeEdit() {
    setEditingGroup(null)
    setEditQuantities({})
    setRemovedSaleIds(new Set())
  }

  function setRowQty(saleId: string, qty: number) {
    if (qty <= 0) {
      setRemovedSaleIds((prev) => new Set(prev).add(saleId))
      return
    }
    setRemovedSaleIds((prev) => {
      const next = new Set(prev)
      next.delete(saleId)
      return next
    })
    setEditQuantities((prev) => ({ ...prev, [saleId]: qty }))
  }

  function toggleRemove(saleId: string) {
    setRemovedSaleIds((prev) => {
      const next = new Set(prev)
      if (next.has(saleId)) next.delete(saleId)
      else next.add(saleId)
      return next
    })
  }

  async function submitEdit() {
    if (!editingGroup) return
    setEditSubmitting(true)
    try {
      // Process each row that changed
      const operations: Promise<Response>[] = []
      for (const sale of editingGroup) {
        const newQty = removedSaleIds.has(sale.id) ? 0 : (editQuantities[sale.id] ?? sale.quantity)
        if (newQty === sale.quantity) continue // unchanged

        if (newQty === 0) {
          // Delete the sale (returns stock)
          operations.push(
            fetch(`/api/sales/${sale.id}`, { method: 'DELETE' })
          )
        } else {
          operations.push(
            fetch(`/api/sales/${sale.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ quantity: newQty }),
            })
          )
        }
      }

      if (operations.length === 0) {
        closeEdit()
        return
      }

      const results = await Promise.all(operations)
      const failures = results.filter((r) => !r.ok)
      if (failures.length > 0) {
        const body = await failures[0].json().catch(() => ({}))
        throw new Error(body?.error ?? `${failures.length} update(s) failed`)
      }

      toast.success(`Transaction updated (${operations.length} item${operations.length !== 1 ? 's' : ''})`)
      closeEdit()
      loadDashboard()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update transaction'
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
      {/* Top action bar — Guide + refresh (own row, no overlap) */}
      <div className="flex items-center justify-between gap-3 pb-1">
        <Link
          href="/store/help"
          className="flex items-center gap-1.5 text-xs font-semibold text-[#0A0A0A] bg-[#FFD700] px-3 py-2 rounded-lg shadow-sm"
        >
          <BookOpen size={14} />
          Tutorial Guide
        </Link>
        <button
          onClick={loadDashboard}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Today */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Today</h2>
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

      {/* Recent transactions — grouped by sale_group_id */}
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
            {groupedTransactions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No sales recorded yet.</p>
            ) : (
              groupedTransactions.map(({ key, sales }) => {
                const totalPairs = sales.reduce((s, x) => s + x.quantity, 0)
                const totalAmount = sales.reduce((s, x) => s + x.total_amount, 0)
                const firstSale = sales[0]
                const productCount = sales.length
                return (
                  <div key={key} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {productCount === 1 ? (
                        <p className="text-sm font-medium text-[#0A0A0A] truncate">
                          {firstSale.product?.name ?? 'Unknown Product'}
                        </p>
                      ) : (
                        <p className="text-sm font-medium text-[#0A0A0A] truncate">
                          {productCount} products · {sales.map((s) => s.product?.sku).filter(Boolean).join(', ')}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">
                        {timeAgo(firstSale.created_at)} · {totalPairs} pair{totalPairs !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-[#0A0A0A]">{formatCurrency(totalAmount)}</p>
                    </div>
                    <button
                      onClick={() => openEdit(sales)}
                      className="flex items-center gap-1 px-2.5 h-8 rounded-lg bg-[#FFD700] text-[#0A0A0A] text-xs font-bold shrink-0"
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                  </div>
                )
              })
            )}
          </div>
        )}
      </section>

      {/* Edit transaction modal — handles multi-item groups */}
      {editingGroup && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !editSubmitting && closeEdit()} />
          <div className="relative bg-white rounded-t-2xl w-full max-w-lg px-5 pt-5 pb-6 shadow-2xl mb-[72px] max-h-[80vh] flex flex-col">
            <div className="flex justify-center mb-3 shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-base font-bold text-[#0A0A0A]">
                Edit Transaction
                <span className="text-xs font-normal text-gray-400 ml-2">
                  {editingGroup.length} item{editingGroup.length !== 1 ? 's' : ''}
                </span>
              </h3>
              <button
                onClick={closeEdit}
                disabled={editSubmitting}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-3 shrink-0">
              {formatMYDate(editingGroup[0].sale_date)} · adjust quantity or remove items
            </p>

            <div className="flex-1 overflow-y-auto space-y-3 -mx-1 px-1">
              {editingGroup.map((sale) => {
                const currentQty = editQuantities[sale.id] ?? sale.quantity
                const removed = removedSaleIds.has(sale.id)
                const newSubtotal = removed ? 0 : sale.unit_price * currentQty
                const delta = removed ? -sale.quantity : currentQty - sale.quantity

                return (
                  <div
                    key={sale.id}
                    className={cn(
                      'rounded-xl p-3 border-2 transition-colors',
                      removed
                        ? 'bg-red-50 border-red-200 opacity-60'
                        : delta !== 0
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-gray-50 border-transparent',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-bold', removed ? 'line-through text-gray-400' : 'text-[#0A0A0A]')}>
                          {sale.product?.name}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">{sale.product?.sku}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatCurrency(sale.unit_price)} / pair · was Qty {sale.quantity}
                        </p>
                      </div>
                      <p className={cn('text-sm font-bold shrink-0', removed && 'line-through text-gray-400')}>
                        {formatCurrency(newSubtotal)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {removed ? (
                        <button
                          onClick={() => toggleRemove(sale.id)}
                          disabled={editSubmitting}
                          className="text-xs font-semibold text-blue-600 underline"
                        >
                          Undo remove
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setRowQty(sale.id, currentQty - 1)}
                            disabled={editSubmitting}
                            className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100 disabled:opacity-40"
                          >
                            <span className="text-base font-bold">−</span>
                          </button>
                          <span className="w-8 text-center text-base font-bold">{currentQty}</span>
                          <button
                            onClick={() => setRowQty(sale.id, currentQty + 1)}
                            disabled={editSubmitting}
                            className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100 disabled:opacity-40"
                          >
                            <span className="text-base font-bold">+</span>
                          </button>
                          {delta !== 0 && (
                            <span className="text-[10px] text-amber-700 font-semibold ml-1">
                              {delta > 0 ? `+${delta}` : delta} from stock
                            </span>
                          )}
                        </div>
                      )}
                      {!removed && (
                        <button
                          onClick={() => toggleRemove(sale.id)}
                          disabled={editSubmitting}
                          className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center hover:bg-red-100 disabled:opacity-40"
                        >
                          <Trash2 size={13} className="text-red-500" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {(() => {
              const newTotal = editingGroup.reduce((s, sale) => {
                if (removedSaleIds.has(sale.id)) return s
                const q = editQuantities[sale.id] ?? sale.quantity
                return s + sale.unit_price * q
              }, 0)
              const oldTotal = editingGroup.reduce((s, sale) => s + sale.total_amount, 0)
              const hasChanges =
                removedSaleIds.size > 0 ||
                editingGroup.some((s) => (editQuantities[s.id] ?? s.quantity) !== s.quantity)

              return (
                <div className="shrink-0 pt-3 mt-2 border-t border-gray-100 space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500">New total</span>
                    <span className="font-bold text-[#0A0A0A]">
                      {formatCurrency(newTotal)}
                      {newTotal !== oldTotal && (
                        <span className="text-xs text-gray-400 ml-2 line-through">{formatCurrency(oldTotal)}</span>
                      )}
                    </span>
                  </div>
                  <button
                    onClick={submitEdit}
                    disabled={editSubmitting || !hasChanges}
                    className={cn(
                      'w-full h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-bold text-base flex items-center justify-center gap-2',
                      (editSubmitting || !hasChanges)
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
              )
            })()}
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
