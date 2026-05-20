'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download } from 'lucide-react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMYDate, formatMonthYear, cn, STORE_TYPE_LABELS } from '@/lib/utils'
import type { Store } from '@/types'

type ReportTab = 'sales' | 'stores' | 'inventory' | 'commissions'

const TABS: { label: string; value: ReportTab }[] = [
  { label: 'Sales Performance', value: 'sales' },
  { label: 'Store Performance', value: 'stores' },
  { label: 'Inventory Report', value: 'inventory' },
  { label: 'Commission Report', value: 'commissions' },
]

function exportCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return
  const headers = Object.keys(data[0])
  const rows = data.map((r) => headers.map((h) => `"${String(r[h] ?? '')}"`).join(','))
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('sales')
  const supabase = createClient()

  // ── Sales tab state
  const now = new Date()
  const [salesFrom, setSalesFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
  const [salesTo, setSalesTo] = useState(now.toISOString().slice(0, 10))
  const [salesData, setSalesData] = useState<any[]>([])
  const [salesByType, setSalesByType] = useState<any[]>([])
  const [salesBySKU, setSalesBySKU] = useState<any[]>([])
  const [salesByState, setSalesByState] = useState<any[]>([])
  const [salesMetrics, setSalesMetrics] = useState({ totalPairs: 0, totalRevenue: 0, avgPerDay: 0, totalStores: 0 })
  const [salesLoading, setSalesLoading] = useState(false)

  // ── Stores tab state
  const [storeFrom, setStoreFrom] = useState(salesFrom)
  const [storeTo, setStoreTo] = useState(salesTo)
  const [storePerf, setStorePerf] = useState<any[]>([])
  const [storeLoading, setStoreLoading] = useState(false)

  // ── Inventory tab state
  const [invData, setInvData] = useState<any[]>([])
  const [invLoading, setInvLoading] = useState(false)

  // ── Commission tab state
  const [commMonth, setCommMonth] = useState(now.getMonth() + 1)
  const [commYear, setCommYear] = useState(now.getFullYear())
  const [commData, setCommData] = useState<any[]>([])
  const [commLoading, setCommLoading] = useState(false)

  const fetchSales = useCallback(async () => {
    setSalesLoading(true)
    const { data } = await supabase
      .from('sales')
      .select('sale_date, quantity, xocks_revenue, store_id, product_id, stores(store_type, state), products(sku, name)')
      .gte('sale_date', salesFrom)
      .lte('sale_date', salesTo)

    const rows = data || []

    // Daily trend
    const dailyMap: Record<string, { pairs: number; revenue: number }> = {}
    for (const r of rows) {
      const day = r.sale_date.slice(0, 10)
      if (!dailyMap[day]) dailyMap[day] = { pairs: 0, revenue: 0 }
      dailyMap[day].pairs += r.quantity
      dailyMap[day].revenue += r.xocks_revenue
    }
    setSalesData(Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })))

    // By store type
    const typeMap: Record<string, number> = {}
    for (const r of rows) {
      const t = (r.stores as any)?.store_type || 'other'
      typeMap[t] = (typeMap[t] || 0) + r.quantity
    }
    setSalesByType(Object.entries(typeMap).map(([type, pairs]) => ({ type: STORE_TYPE_LABELS[type] || type, pairs })))

    // By SKU
    const skuMap: Record<string, { name: string; pairs: number }> = {}
    for (const r of rows) {
      const sku = (r.products as any)?.sku || r.product_id
      const name = (r.products as any)?.name || sku
      if (!skuMap[sku]) skuMap[sku] = { name, pairs: 0 }
      skuMap[sku].pairs += r.quantity
    }
    setSalesBySKU(Object.entries(skuMap).sort((a, b) => b[1].pairs - a[1].pairs).slice(0, 10).map(([sku, v]) => ({ sku, ...v })))

    // By state
    const stateMap: Record<string, number> = {}
    for (const r of rows) {
      const st = (r.stores as any)?.state || 'Unknown'
      stateMap[st] = (stateMap[st] || 0) + r.quantity
    }
    setSalesByState(Object.entries(stateMap).sort((a, b) => b[1] - a[1]).map(([state, pairs]) => ({ state, pairs })))

    const totalPairs = rows.reduce((a, r) => a + r.quantity, 0)
    const totalRevenue = rows.reduce((a, r) => a + r.xocks_revenue, 0)
    const days = Math.max(1, Math.ceil((new Date(salesTo).getTime() - new Date(salesFrom).getTime()) / 86400000))
    setSalesMetrics({
      totalPairs,
      totalRevenue,
      avgPerDay: Math.round(totalPairs / days),
      totalStores: new Set(rows.map((r) => r.store_id)).size,
    })
    setSalesLoading(false)
  }, [salesFrom, salesTo])

  const fetchStores = useCallback(async () => {
    setStoreLoading(true)
    const { data: stores } = await supabase
      .from('stores')
      .select('id, store_name, city, state, store_type, performance_score, consecutive_low_months')
      .eq('status', 'active')

    const { data: sales } = await supabase
      .from('sales')
      .select('store_id, quantity, xocks_revenue')
      .gte('sale_date', storeFrom)
      .lte('sale_date', storeTo)

    const salesByStore: Record<string, { pairs: number; revenue: number }> = {}
    for (const s of sales || []) {
      if (!salesByStore[s.store_id]) salesByStore[s.store_id] = { pairs: 0, revenue: 0 }
      salesByStore[s.store_id].pairs += s.quantity
      salesByStore[s.store_id].revenue += s.xocks_revenue
    }

    const perf = (stores || []).map((s: any) => ({
      id: s.id,
      store_name: s.store_name,
      city: s.city,
      state: s.state,
      type: STORE_TYPE_LABELS[s.store_type] || s.store_type,
      performance_score: s.performance_score,
      consecutive_low_months: s.consecutive_low_months,
      pairs: salesByStore[s.id]?.pairs || 0,
      revenue: salesByStore[s.id]?.revenue || 0,
    })).sort((a: any, b: any) => b.pairs - a.pairs)

    setStorePerf(perf)
    setStoreLoading(false)
  }, [storeFrom, storeTo])

  const fetchInventory = useCallback(async () => {
    setInvLoading(true)
    const { data } = await supabase
      .from('store_inventory')
      .select('product_id, quantity_on_hand, restock_threshold, store_id, products(sku, name, category)')

    const productMap: Record<string, {
      sku: string; name: string; category: string;
      total: number; stores: number; zero_stores: number; below_threshold: number
    }> = {}

    for (const inv of data || []) {
      const pid = inv.product_id
      const prod = inv.products as any
      if (!productMap[pid]) {
        productMap[pid] = { sku: prod?.sku || pid, name: prod?.name || pid, category: prod?.category || '', total: 0, stores: 0, zero_stores: 0, below_threshold: 0 }
      }
      productMap[pid].total += inv.quantity_on_hand
      productMap[pid].stores++
      if (inv.quantity_on_hand === 0) productMap[pid].zero_stores++
      if (inv.quantity_on_hand <= inv.restock_threshold) productMap[pid].below_threshold++
    }

    setInvData(Object.values(productMap).sort((a, b) => b.zero_stores - a.zero_stores))
    setInvLoading(false)
  }, [])

  const fetchCommissions = useCallback(async () => {
    setCommLoading(true)
    const { data } = await supabase
      .from('commission_periods')
      .select('*, store:stores(store_name, city, state)')
      .eq('period_month', commMonth)
      .eq('period_year', commYear)
      .order('commission_amount', { ascending: false })

    setCommData(
      (data || []).map((c: any) => ({
        id: c.id,
        store_name: c.store?.store_name || '—',
        city: c.store?.city || '—',
        state: c.store?.state || '—',
        pairs: c.total_units_sold,
        revenue: c.total_revenue,
        commission: c.commission_amount,
        status: c.status,
      }))
    )
    setCommLoading(false)
  }, [commMonth, commYear])

  useEffect(() => { if (activeTab === 'sales') fetchSales() }, [activeTab, fetchSales])
  useEffect(() => { if (activeTab === 'stores') fetchStores() }, [activeTab, fetchStores])
  useEffect(() => { if (activeTab === 'inventory') fetchInventory() }, [activeTab, fetchInventory])
  useEffect(() => { if (activeTab === 'commissions') fetchCommissions() }, [activeTab, fetchCommissions])

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex overflow-x-auto border-b border-gray-100 px-4">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                activeTab === tab.value
                  ? 'border-[#FFD700] text-[#0A0A0A]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* ── Sales Performance ── */}
          {activeTab === 'sales' && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From</label>
                  <input type="date" value={salesFrom} onChange={(e) => setSalesFrom(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">To</label>
                  <input type="date" value={salesTo} onChange={(e) => setSalesTo(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                </div>
                <button onClick={fetchSales}
                  className="px-4 py-2 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 transition-colors">
                  Apply
                </button>
                <button onClick={() => exportCSV(salesData.map(d => ({ Date: d.date, 'Pairs Sold': d.pairs, Revenue: d.revenue })), 'sales-report.csv')}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2">
                  <Download size={14} /> CSV
                </button>
              </div>

              {/* Metric cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Pairs', value: salesLoading ? '—' : salesMetrics.totalPairs.toLocaleString() },
                  { label: 'Revenue', value: salesLoading ? '—' : formatCurrency(salesMetrics.totalRevenue) },
                  { label: 'Avg Pairs/Day', value: salesLoading ? '—' : salesMetrics.avgPerDay.toString() },
                  { label: 'Active Stores', value: salesLoading ? '—' : salesMetrics.totalStores.toString() },
                ].map((m) => (
                  <div key={m.label} className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500">{m.label}</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Daily trend */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily Pairs Sold</h3>
                {salesLoading ? (
                  <div className="h-48 bg-gray-100 animate-pulse rounded-xl" />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={salesData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="pairs" stroke="#0A0A0A" strokeWidth={2} dot={false} name="Pairs" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* By store type + by state */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Sales by Store Type</h3>
                  {salesLoading ? <div className="h-40 bg-gray-100 animate-pulse rounded-xl" /> : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={salesByType} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis dataKey="type" type="category" tick={{ fontSize: 10 }} width={100} />
                        <Tooltip />
                        <Bar dataKey="pairs" fill="#0A0A0A" name="Pairs" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Sales by State</h3>
                  {salesLoading ? <div className="h-40 bg-gray-100 animate-pulse rounded-xl" /> : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={salesByState} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis dataKey="state" type="category" tick={{ fontSize: 10 }} width={90} />
                        <Tooltip />
                        <Bar dataKey="pairs" fill="#FFD700" name="Pairs" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Top SKUs */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Top 10 SKUs</h3>
                {salesLoading ? <div className="h-40 bg-gray-100 animate-pulse rounded-xl" /> : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={salesBySKU}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="sku" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="pairs" fill="#0A0A0A" name="Pairs" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* ── Store Performance ── */}
          {activeTab === 'stores' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From</label>
                  <input type="date" value={storeFrom} onChange={(e) => setStoreFrom(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">To</label>
                  <input type="date" value={storeTo} onChange={(e) => setStoreTo(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                </div>
                <button onClick={fetchStores}
                  className="px-4 py-2 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 transition-colors">
                  Apply
                </button>
                <button onClick={() => exportCSV(storePerf.map((s: any) => ({ Store: s.store_name, City: s.city, State: s.state, 'Pairs': s.pairs, Revenue: s.revenue, Score: s.performance_score })), 'store-performance.csv')}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2">
                  <Download size={14} /> CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">#</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Store</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">City</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">State</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Type</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Pairs</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Revenue</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storeLoading ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        {Array.from({ length: 8 }).map((_, j) => (
                          <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 animate-pulse rounded" /></td>
                        ))}
                      </tr>
                    )) : storePerf.map((s: any, i: number) => (
                      <tr key={s.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50', s.consecutive_low_months >= 2 && 'bg-red-50/30')}>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">
                          {s.store_name}
                          {s.consecutive_low_months >= 2 && (
                            <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[10px] font-semibold">
                              AT RISK
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{s.city}</td>
                        <td className="px-4 py-2.5 text-gray-600">{s.state}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{s.type}</td>
                        <td className="px-4 py-2.5 text-right font-medium">{s.pairs}</td>
                        <td className="px-4 py-2.5 text-right">{formatCurrency(s.revenue)}</td>
                        <td className={cn('px-4 py-2.5 text-right font-bold', s.performance_score >= 50 ? 'text-green-600' : s.performance_score >= 20 ? 'text-amber-600' : 'text-red-600')}>
                          {s.performance_score}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Inventory Report ── */}
          {activeTab === 'inventory' && (
            <div className="space-y-5">
              <div className="flex justify-end">
                <button onClick={() => exportCSV(invData.map((d: any) => ({ SKU: d.sku, Name: d.name, 'Total Deployed': d.total, Stores: d.stores, 'Zero Stock Stores': d.zero_stores, 'Below Threshold': d.below_threshold })), 'inventory-report.csv')}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2">
                  <Download size={14} /> CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">SKU</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Product</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Total Deployed</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Stores</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Zero Stock</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Below Threshold</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Restock Rec.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invLoading ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 animate-pulse rounded" /></td>
                        ))}
                      </tr>
                    )) : invData.map((d: any) => (
                      <tr key={d.sku} className={cn('border-b border-gray-50 hover:bg-gray-50/50', d.zero_stores > 0 && 'bg-red-50/20')}>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{d.sku}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{d.name}</td>
                        <td className="px-4 py-2.5 text-right">{d.total}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{d.stores}</td>
                        <td className="px-4 py-2.5 text-right">
                          {d.zero_stores > 0 ? (
                            <span className="font-semibold text-red-600">{d.zero_stores}</span>
                          ) : <span className="text-gray-400">0</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {d.below_threshold > 0 ? (
                            <span className="font-semibold text-amber-600">{d.below_threshold}</span>
                          ) : <span className="text-gray-400">0</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-500 text-xs">
                          {d.below_threshold > 0 ? `${d.below_threshold * 6} pairs` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Commission Report ── */}
          {activeTab === 'commissions' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-3 items-end">
                <select value={commMonth} onChange={(e) => setCommMonth(Number(e.target.value))}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('en', { month: 'long' })}</option>
                  ))}
                </select>
                <select value={commYear} onChange={(e) => setCommYear(Number(e.target.value))}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
                  {[now.getFullYear() - 1, now.getFullYear()].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <button onClick={fetchCommissions}
                  className="px-4 py-2 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 transition-colors">
                  Apply
                </button>
                <button onClick={() => exportCSV(commData.map((c: any) => ({ Store: c.store_name, City: c.city, State: c.state, Pairs: c.pairs, Revenue: c.revenue, Commission: c.commission, Status: c.status })), `commission-${commYear}-${commMonth}.csv`)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2">
                  <Download size={14} /> CSV
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-500">Total Commission Liability</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">
                    {formatCurrency(commData.reduce((a: number, c: any) => a + c.commission, 0))}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-500">Stores</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{commData.length}</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Store</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">City</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">State</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Pairs</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Revenue</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Commission</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commLoading ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 animate-pulse rounded" /></td>
                        ))}
                      </tr>
                    )) : commData.map((c: any) => (
                      <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium text-gray-800">{c.store_name}</td>
                        <td className="px-4 py-2.5 text-gray-600">{c.city}</td>
                        <td className="px-4 py-2.5 text-gray-600">{c.state}</td>
                        <td className="px-4 py-2.5 text-right">{c.pairs}</td>
                        <td className="px-4 py-2.5 text-right">{formatCurrency(c.revenue)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(c.commission)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                            c.status === 'paid' ? 'bg-green-100 text-green-700' :
                            c.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                            'bg-yellow-100 text-yellow-700')}>
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!commLoading && commData.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">
                          No commission data for {formatMonthYear(commMonth, commYear)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
