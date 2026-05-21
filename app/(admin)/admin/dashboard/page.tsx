'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Store,
  ShoppingBag,
  DollarSign,
  Clock,
  AlertTriangle,
  RefreshCcw,
  Truck,
  TrendingDown,
  ArrowRight,
} from 'lucide-react'
import Link from 'next/link'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMYDate, timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { DashboardKPIs, SalesTrendPoint, StorePerformanceRow, Sale } from '@/types'

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
      <div className="h-8 bg-gray-200 rounded w-32 mb-1" />
      <div className="h-3 bg-gray-100 rounded w-20" />
    </div>
  )
}

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        <div className={cn('p-2 rounded-lg', color)}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

interface ActivityItem {
  id: string
  created_at: string
  store_name: string
  product_name: string
  quantity: number
  total_amount: number
  payment_method: string
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null)
  const [trend, setTrend] = useState<SalesTrendPoint[]>([])
  const [topStores, setTopStores] = useState<StorePerformanceRow[]>([])
  const [bottomStores, setBottomStores] = useState<StorePerformanceRow[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchDashboard = useCallback(async () => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [
      storesRes,
      salesMTDRes,
      commissionsRes,
      lowStockRes,
      pendingRestocksRes,
      dosRes,
      atRiskRes,
      trendRes,
      storePerformanceRes,
      activityRes,
    ] = await Promise.all([
      supabase.from('stores').select('id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('sales').select('quantity, xocks_revenue').gte('sale_date', startOfMonth),
      supabase
        .from('commission_periods')
        .select('commission_amount')
        .in('status', ['pending', 'approved']),
      supabase
        .from('restock_alerts')
        .select('id', { count: 'exact' })
        .eq('status', 'pending'),
      supabase
        .from('restock_requests')
        .select('id', { count: 'exact' })
        .eq('status', 'pending'),
      supabase
        .from('delivery_orders')
        .select('id', { count: 'exact' })
        .eq('status', 'dispatched'),
      supabase
        .from('stores')
        .select('id', { count: 'exact' })
        .gte('consecutive_low_months', 2),
      supabase
        .from('sales')
        .select('sale_date, quantity, xocks_revenue')
        .gte('sale_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('sale_date', { ascending: true }),
      supabase
        .from('stores')
        .select('id, store_code, store_name, city, state, performance_score, consecutive_low_months')
        .eq('status', 'active')
        .order('performance_score', { ascending: false }),
      supabase
        .from('sales')
        .select('id, created_at, quantity, total_amount, payment_method, stores(store_name), products(name)')
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const salesMTD = salesMTDRes.data || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalPairs = salesMTD.reduce((a: number, s: any) => a + (s.quantity || 0), 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const revenueMTD = salesMTD.reduce((a: number, s: any) => a + (s.xocks_revenue || 0), 0)
    const commissionsDue = (commissionsRes.data || []).reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: number, c: any) => a + (c.commission_amount || 0),
      0
    )

    setKpis({
      active_stores: storesRes.count || 0,
      total_sales_mtd: totalPairs,
      revenue_mtd: revenueMTD,
      commissions_due: commissionsDue,
      low_stock_alerts: lowStockRes.count || 0,
      pending_restocks: pendingRestocksRes.count || 0,
      dos_in_transit: dosRes.count || 0,
      at_risk_stores: atRiskRes.count || 0,
    })

    // Build trend data (group by date)
    const trendMap: Record<string, { pairs_sold: number; revenue: number }> = {}
    for (const row of trendRes.data || []) {
      const day = row.sale_date.slice(0, 10)
      if (!trendMap[day]) trendMap[day] = { pairs_sold: 0, revenue: 0 }
      trendMap[day].pairs_sold += row.quantity || 0
      trendMap[day].revenue += row.xocks_revenue || 0
    }
    setTrend(
      Object.entries(trendMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v }))
    )

    // Store performance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stores: any[] = storePerformanceRes.data || []
    const storeIds = stores.map((s) => s.id)
    let saleMTDByStore: Record<string, { pairs: number; revenue: number }> = {}
    if (storeIds.length > 0) {
      const { data: storeSales } = await supabase
        .from('sales')
        .select('store_id, quantity, xocks_revenue')
        .in('store_id', storeIds)
        .gte('sale_date', startOfMonth)
      for (const s of storeSales || []) {
        if (!saleMTDByStore[s.store_id]) saleMTDByStore[s.store_id] = { pairs: 0, revenue: 0 }
        saleMTDByStore[s.store_id].pairs += s.quantity || 0
        saleMTDByStore[s.store_id].revenue += s.xocks_revenue || 0
      }
    }

    const perf: StorePerformanceRow[] = stores.map((s) => ({
      store_id: s.id,
      store_code: s.store_code,
      store_name: s.store_name,
      city: s.city,
      state: s.state,
      performance_score: s.performance_score,
      consecutive_low_months: s.consecutive_low_months,
      pairs_sold: saleMTDByStore[s.id]?.pairs || 0,
      revenue: saleMTDByStore[s.id]?.revenue || 0,
    }))

    const sorted = [...perf].sort((a, b) => b.pairs_sold - a.pairs_sold)
    setTopStores(sorted.slice(0, 10))
    setBottomStores([...sorted].reverse().slice(0, 10))

    // Activity feed
    const acts: ActivityItem[] = (activityRes.data || []).map((row: any) => ({
      id: row.id,
      created_at: row.created_at,
      store_name: row.stores?.store_name || '—',
      product_name: row.products?.name || '—',
      quantity: row.quantity,
      total_amount: row.total_amount,
      payment_method: row.payment_method,
    }))
    setActivity(acts)

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchDashboard()

    // Realtime subscription for new sales
    const channel = supabase
      .channel('sales-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sales' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (payload: any) => {
          const sale = payload.new as Sale & { store_id: string; product_id: string }
          const [{ data: storeData }, { data: productData }] = await Promise.all([
            supabase.from('stores').select('store_name').eq('id', sale.store_id).single(),
            supabase.from('products').select('name').eq('id', sale.product_id).single(),
          ])
          const newItem: ActivityItem = {
            id: sale.id,
            created_at: sale.created_at,
            store_name: storeData?.store_name || '—',
            product_name: productData?.name || '—',
            quantity: sale.quantity,
            total_amount: sale.total_amount,
            payment_method: sale.payment_method,
          }
          setActivity((prev) => [newItem, ...prev.slice(0, 19)])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchDashboard])

  const kpiRow1 = kpis
    ? [
        {
          label: 'Active Stores',
          value: kpis.active_stores.toString(),
          icon: Store,
          color: 'bg-blue-500',
          sub: 'Total active consignees',
        },
        {
          label: 'Total Sales MTD',
          value: `${kpis.total_sales_mtd.toLocaleString()} pairs`,
          icon: ShoppingBag,
          color: 'bg-green-500',
          sub: 'This month',
        },
        {
          label: 'Revenue MTD',
          value: formatCurrency(kpis.revenue_mtd),
          icon: DollarSign,
          color: 'bg-[#0A0A0A]',
          sub: 'Xocks revenue',
        },
        {
          label: 'Commissions Due',
          value: formatCurrency(kpis.commissions_due),
          icon: Clock,
          color: 'bg-amber-500',
          sub: 'Pending + approved',
        },
      ]
    : null

  const kpiRow2 = kpis
    ? [
        {
          label: 'Low Stock Alerts',
          value: kpis.low_stock_alerts.toString(),
          icon: AlertTriangle,
          color: 'bg-orange-500',
          sub: 'Stores below threshold',
        },
        {
          label: 'Pending Restocks',
          value: kpis.pending_restocks.toString(),
          icon: RefreshCcw,
          color: 'bg-purple-500',
          sub: 'Awaiting approval',
        },
        {
          label: 'DOs In Transit',
          value: kpis.dos_in_transit.toString(),
          icon: Truck,
          color: 'bg-cyan-500',
          sub: 'Dispatched DOs',
        },
        {
          label: 'At-Risk Stores',
          value: kpis.at_risk_stores.toString(),
          icon: TrendingDown,
          color: 'bg-red-500',
          sub: '2+ consecutive low months',
        },
      ]
    : null

  return (
    <div className="space-y-6">
      {/* KPI Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || !kpiRow1
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : kpiRow1.map((k) => <KPICard key={k.label} {...k} />)}
      </div>

      {/* KPI Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || !kpiRow2
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : kpiRow2.map((k) => <KPICard key={k.label} {...k} />)}
      </div>

      {/* Sales Trend */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Sales Trend — Last 30 Days</h2>
        {loading ? (
          <div className="h-56 bg-gray-100 animate-pulse rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value, name) =>
                  name === 'revenue' ? formatCurrency(Number(value)) : value
                }
              />
              <Line
                type="monotone"
                dataKey="pairs_sold"
                stroke="#0A0A0A"
                strokeWidth={2}
                dot={false}
                name="Pairs Sold"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Store Tables + Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Top 10 */}
        <div className="xl:col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Top 10 Stores</h2>
            <Link
              href="/stores"
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {topStores.map((s, i) => (
                <Link
                  key={s.store_id}
                  href={`/stores/${s.store_id}`}
                  className="flex items-center gap-3 py-1.5 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                >
                  <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.store_name}</p>
                    <p className="text-xs text-gray-400">{s.state}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700">
                    {s.pairs_sold} pairs
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Bottom 10 */}
        <div className="xl:col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Bottom 10 Stores</h2>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {bottomStores.map((s, i) => (
                <Link
                  key={s.store_id}
                  href={`/stores/${s.store_id}`}
                  className="flex items-center gap-3 py-1.5 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                >
                  <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{s.store_name}</p>
                    <p className="text-xs text-gray-400">{s.state}</p>
                  </div>
                  <span className={cn('text-sm font-semibold', s.pairs_sold === 0 ? 'text-red-500' : 'text-amber-500')}>
                    {s.pairs_sold} pairs
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Realtime Activity */}
        <div className="xl:col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Live Activity</h2>
            <span className="flex items-center gap-1.5 text-xs text-green-600">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          </div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 bg-gray-100 animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {activity.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No recent sales</p>
              ) : (
                activity.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 text-sm border-b border-gray-50 pb-3 last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{item.store_name}</p>
                      <p className="text-xs text-gray-500">
                        {item.product_name} × {item.quantity}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold text-gray-800">
                        {formatCurrency(item.total_amount)}
                      </p>
                      <p className="text-xs text-gray-400">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pending Actions */}
      {kpis && (kpis.pending_restocks > 0 || kpis.low_stock_alerts > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-3">Pending Actions Required</h2>
          <div className="flex flex-wrap gap-4">
            {kpis.pending_restocks > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-amber-700">
                  {kpis.pending_restocks} restock request{kpis.pending_restocks !== 1 ? 's' : ''} awaiting review
                </span>
                <Link
                  href="/restocks"
                  className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Review Now
                </Link>
              </div>
            )}
            {kpis.low_stock_alerts > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-amber-700">
                  {kpis.low_stock_alerts} low stock alert{kpis.low_stock_alerts !== 1 ? 's' : ''}
                </span>
                <Link
                  href="/stock"
                  className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 transition-colors"
                >
                  View Stock
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
