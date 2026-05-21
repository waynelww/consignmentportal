'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AlertTriangle, TrendingUp, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, timeAgo, getStockStatus } from '@/lib/utils'
import type { Sale, StoreInventory, Profile, Store, CommissionPeriod } from '@/types'
import { cn } from '@/lib/utils'

interface DashboardData {
  store: Store | null
  todaySales: number
  todayRevenue: number
  todayCommission: number
  inventory: StoreInventory[]
  monthSales: number
  monthRevenue: number
  monthCommission: number
  commissionRate: number
  recentSales: Sale[]
  totalStock: number
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
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('store_id')
      .eq('id', user.id)
      .single<Profile>()

    if (!profile?.store_id) { setLoading(false); return }

    const storeId = profile.store_id

    // Compute date strings in MYT before firing queries
    const myNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr     = `${myNow.getFullYear()}-${pad(myNow.getMonth() + 1)}-${pad(myNow.getDate())}`
    const firstOfMonth = `${myNow.getFullYear()}-${pad(myNow.getMonth() + 1)}-01`

    const [storeRes, inventoryRes, todaySalesRes, monthSalesRes, recentSalesRes, commissionRes] = await Promise.all([
      supabase.from('stores').select('*').eq('id', storeId).single<Store>(),
      supabase
        .from('store_inventory')
        .select('*, product:products(*)')
        .eq('store_id', storeId)
        .order('quantity_on_hand', { ascending: true }),
      // Today's totals only — lightweight, no product join
      supabase
        .from('sales')
        .select('quantity, total_amount, commission_amount')
        .eq('store_id', storeId)
        .eq('sale_date', todayStr),
      // This month's totals only — lightweight, no product join
      supabase
        .from('sales')
        .select('quantity, total_amount, commission_amount')
        .eq('store_id', storeId)
        .gte('sale_date', firstOfMonth)
        .lte('sale_date', todayStr),
      // Recent sales — just 5 rows with product name
      supabase
        .from('sales')
        .select('*, product:products(*)')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('commission_periods')
        .select('*')
        .eq('store_id', storeId)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(1)
        .single<CommissionPeriod>(),
    ])

    type SaleTotals = { quantity: number; total_amount: number; commission_amount: number }
    const store     = storeRes.data
    const inventory = (inventoryRes.data as StoreInventory[]) ?? []
    const todayArr  = (todaySalesRes.data ?? []) as SaleTotals[]
    const monthArr  = (monthSalesRes.data ?? []) as SaleTotals[]
    const recentSales = (recentSalesRes.data as Sale[]) ?? []

    const totalStock = inventory.reduce((sum, i) => sum + i.quantity_on_hand, 0)

    setData({
      store: store ?? null,
      todaySales:      todayArr.reduce((s, x) => s + x.quantity, 0),
      todayRevenue:    todayArr.reduce((s, x) => s + x.total_amount, 0),
      todayCommission: todayArr.reduce((s, x) => s + x.commission_amount, 0),
      inventory,
      monthSales:      monthArr.reduce((s, x) => s + x.quantity, 0),
      monthRevenue:    monthArr.reduce((s, x) => s + x.total_amount, 0),
      monthCommission: monthArr.reduce((s, x) => s + x.commission_amount, 0),
      commissionRate: store?.commission_rate ?? 0,
      recentSales,
      totalStock,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const lowStockItems = data?.inventory.filter(
    (i) => getStockStatus(i.quantity_on_hand, i.restock_threshold) === 'low_stock',
  ) ?? []

  const totalInventoryItems = data?.inventory.length ?? 0
  const sellThrough =
    totalInventoryItems > 0 && data
      ? Math.min(100, Math.round((data.monthSales / (data.monthSales + data.totalStock || 1)) * 100))
      : 0

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
  const monthName = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' })

  return (
    <div className="px-4 py-5 space-y-6 max-w-lg mx-auto">
      {/* Low stock banner */}
      {!loading && lowStockItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              You have {lowStockItems.length} low stock item{lowStockItems.length !== 1 ? 's' : ''}.
            </p>
            <Link href="/store/restock-request" className="text-xs text-amber-700 underline mt-0.5 inline-block">
              Request restock →
            </Link>
          </div>
        </div>
      )}

      {/* Section 1 — Today's Summary */}
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

      {/* Section 2 — Current Stock */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Current Stock</h2>
        {loading ? (
          <SkeletonList />
        ) : (
          <div className="space-y-2">
            {(data?.inventory ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No inventory yet.</p>
            ) : (
              (data?.inventory ?? []).map((item) => {
                const status = getStockStatus(item.quantity_on_hand, item.restock_threshold)
                return (
                  <div key={item.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#0A0A0A] truncate">{item.product?.name}</p>
                      <p className="text-xs text-gray-400">{item.product?.sku}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      {status === 'low_stock' && (
                        <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                          Low Stock
                        </span>
                      )}
                      {status === 'out_of_stock' && (
                        <span className="text-[10px] font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                          Out of Stock
                        </span>
                      )}
                      <div className="flex items-center gap-1">
                        <div
                          className={cn(
                            'w-2 h-2 rounded-full',
                            status === 'in_stock' && 'bg-green-500',
                            status === 'low_stock' && 'bg-amber-500',
                            status === 'out_of_stock' && 'bg-red-500',
                          )}
                        />
                        <span className="text-base font-bold text-[#0A0A0A]">{item.quantity_on_hand}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </section>

      {/* Section 3 — Quick Actions */}
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

      {/* Section 4 — This Month */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {monthName}
        </h2>
        {loading ? (
          <SkeletonCard />
        ) : (
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500">Pairs Sold</p>
                <p className="text-2xl font-bold text-[#0A0A0A]">{data?.monthSales ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Commission</p>
                <p className="text-2xl font-bold text-[#22C55E]">{formatCurrency(data?.monthCommission ?? 0)}</p>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Sell-through</span>
                <span>{sellThrough}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FFD700] rounded-full transition-all duration-500"
                  style={{ width: `${sellThrough}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Section 5 — Recent Sales */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Recent Sales</h2>
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
                <div key={sale.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0A0A0A] truncate">
                      {sale.product?.name ?? 'Unknown Product'}
                    </p>
                    <p className="text-xs text-gray-400">{timeAgo(sale.created_at)} · Qty {sale.quantity}</p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className="text-sm font-semibold text-[#0A0A0A]">{formatCurrency(sale.total_amount)}</p>
                    <span
                      className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                        sale.payment_method === 'qr'
                          ? 'bg-teal-100 text-teal-700'
                          : 'bg-gray-100 text-gray-600',
                      )}
                    >
                      {sale.payment_method === 'qr' ? 'QR' : 'Cash'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>
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
