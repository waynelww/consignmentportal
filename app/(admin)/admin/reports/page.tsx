'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
import type { StoreStaffReport } from '@/lib/reports/sales-by-staff'
import {
  MONTHLY_AVERAGE_OPTIONS, DEFAULT_MONTHLY_AVERAGE_MONTHS,
  type MonthlyAverageMonths, type MonthlyAverageResult, type MonthlyAverageRow,
} from '@/lib/reports/monthly-average'

type ReportTab = 'sales' | 'stores' | 'inventory' | 'commissions' | 'monthly'

const TABS: { label: string; value: ReportTab }[] = [
  { label: 'Sales Performance', value: 'sales' },
  { label: 'Store Performance', value: 'stores' },
  { label: 'Inventory Report', value: 'inventory' },
  { label: 'Commission Report', value: 'commissions' },
  { label: 'Monthly Average', value: 'monthly' },
]

type MonthlySortKey = 'store_code' | 'store_name' | 'store_type' | 'state' | 'avg_rm' | 'avg_pairs' | 'total_rm' | 'months_counted' | 'last_month_rm' | 'change_pct'

const MONTHLY_COLUMNS: { key: MonthlySortKey; label: string; numeric: boolean }[] = [
  { key: 'store_code', label: 'Code', numeric: false },
  { key: 'store_name', label: 'Store', numeric: false },
  { key: 'store_type', label: 'Type', numeric: false },
  { key: 'state', label: 'State', numeric: false },
  { key: 'avg_rm', label: 'Sales (RM)', numeric: true },
  { key: 'avg_pairs', label: 'Avg Pairs / Month', numeric: true },
  { key: 'total_rm', label: 'Total for Period (RM)', numeric: true },
  { key: 'months_counted', label: 'Months Counted', numeric: true },
  { key: 'last_month_rm', label: 'Last Full Month (RM)', numeric: true },
  { key: 'change_pct', label: 'Change vs Earlier Avg', numeric: true },
]

const NO_SALES_YET = 'No sales yet'

const monthKeyLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1).toLocaleString('en', { month: 'short', year: 'numeric' })
}

function exportMonthlyAverageCSV(rows: MonthlyAverageRow[], months: number, lastMonth: string) {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines: string[] = [[
    'Store Code', 'Store', 'Type', 'State', 'Status', 'Sales (RM)', 'Avg Pairs / Month',
    'Total for Period (RM)', 'Months Counted', 'Opened (first sale)', 'Last Full Month (RM)', 'Earlier Avg (RM)', 'Change vs Earlier Avg (%)',
  ].map(cell).join(',')]
  for (const r of rows) {
    const none = r.open_month === null // no recorded sales: the screen shows "No sales yet"
    lines.push([
      r.store_code, r.store_name, STORE_TYPE_LABELS[r.store_type] || r.store_type, r.state, r.status,
      none ? NO_SALES_YET : (r.avg_rm ?? ''), r.avg_pairs ?? '', r.total_rm, r.months_counted, r.open_month ?? '',
      r.last_month_rm, r.baseline_avg_rm ?? '', r.change_pct ?? '',
    ].map(cell).join(','))
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `monthly-average-${lastMonth}-${months}m.csv`
  a.click()
  URL.revokeObjectURL(url)
}

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

function exportSalesByStaffCSV(groups: StoreStaffReport[], filename: string) {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines: string[] = [['Store Code', 'Store', 'Keyed in by', 'Source', 'Sales', 'Pairs', 'RM'].map(cell).join(',')]
  for (const g of groups) {
    for (const r of g.rows) {
      const source = r.source === 'staff' ? 'Store staff' : r.source === 'admin' ? 'Admin login' : '-'
      lines.push([g.store_code, g.store_name, r.label, source, r.sales, r.pairs, r.revenue].map(cell).join(','))
    }
    lines.push([g.store_code, g.store_name, 'Total', '', g.total.sales, g.total.pairs, g.total.revenue].map(cell).join(','))
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

import { describeCode, embedded } from '@/lib/restock/low-stock'
import { loadLowStockSettings } from '@/lib/restock/low-stock-settings'
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
  // ── Sales by staff (own month + store filters)
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [sbsMonth, setSbsMonth] = useState(currentMonthKey)
  const [sbsStore, setSbsStore] = useState('all')
  const [sbsStores, setSbsStores] = useState<{ id: string; store_code: string; store_name: string }[]>([])
  const [sbsGroups, setSbsGroups] = useState<StoreStaffReport[]>([])
  const [sbsLoading, setSbsLoading] = useState(false)
  const [sbsError, setSbsError] = useState<string | null>(null)
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

  // ── Monthly Average tab state
  const [monthlyMonths, setMonthlyMonths] = useState<MonthlyAverageMonths>(DEFAULT_MONTHLY_AVERAGE_MONTHS)
  const [monthlyIncludeInactive, setMonthlyIncludeInactive] = useState(false)
  const [monthlyType, setMonthlyType] = useState('all')
  const [monthlyState, setMonthlyState] = useState('all')
  const [monthlySort, setMonthlySort] = useState<{ key: MonthlySortKey; dir: 'asc' | 'desc' }>({ key: 'avg_rm', dir: 'desc' })
  const [monthlyResult, setMonthlyResult] = useState<MonthlyAverageResult | null>(null)
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [monthlyError, setMonthlyError] = useState<string | null>(null)

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
    const lowPct = (await loadLowStockSettings(supabase)).pct
    const { data } = await supabase
      .from('store_inventory')
      .select('product_id, quantity_on_hand, stocked_level, plan_level, store_id, products(sku, name, category), stores:store_id(pairs_per_code, on_stock_plan)')

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
      const invStore = embedded(inv.stores as never) as { pairs_per_code: number; on_stock_plan: boolean } | null
      if (invStore && describeCode(inv, invStore, lowPct).status !== 'in_stock') productMap[pid].below_threshold++
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

  const fetchSalesByStaff = useCallback(async () => {
    setSbsLoading(true)
    setSbsError(null)
    const params = new URLSearchParams({ month: sbsMonth })
    if (sbsStore !== 'all') params.set('store_id', sbsStore)
    const res = await fetch(`/api/reports/sales-by-staff?${params}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setSbsError(body.error ?? 'Could not load sales by staff')
      setSbsGroups([])
    } else {
      setSbsGroups((body.stores ?? []) as StoreStaffReport[])
    }
    setSbsLoading(false)
  }, [sbsMonth, sbsStore])

  useEffect(() => {
    if (activeTab !== 'sales') return
    fetchSalesByStaff()
    supabase.from('stores').select('id, store_code, store_name').order('store_code')
      .then((res: { data: unknown }) => setSbsStores((res.data ?? []) as { id: string; store_code: string; store_name: string }[]))
  }, [activeTab, fetchSalesByStaff])
  useEffect(() => { if (activeTab === 'stores') fetchStores() }, [activeTab, fetchStores])
  useEffect(() => { if (activeTab === 'inventory') fetchInventory() }, [activeTab, fetchInventory])
  useEffect(() => { if (activeTab === 'commissions') fetchCommissions() }, [activeTab, fetchCommissions])

  const fetchMonthly = useCallback(async () => {
    setMonthlyLoading(true)
    setMonthlyError(null)
    const res = await fetch(`/api/reports/monthly-average?months=${monthlyMonths}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMonthlyError(body.error ?? 'Could not load monthly averages')
      setMonthlyResult(null)
    } else {
      setMonthlyResult(body as MonthlyAverageResult)
    }
    setMonthlyLoading(false)
  }, [monthlyMonths])

  useEffect(() => { if (activeTab === 'monthly') fetchMonthly() }, [activeTab, fetchMonthly])

  const monthlyTypeOptions = useMemo(
    () => Array.from(new Set((monthlyResult?.rows ?? []).map((r) => r.store_type))).sort(),
    [monthlyResult]
  )
  const monthlyStateOptions = useMemo(
    () => Array.from(new Set((monthlyResult?.rows ?? []).map((r) => r.state))).sort(),
    [monthlyResult]
  )
  const monthlyRows = useMemo(() => {
    const rows = (monthlyResult?.rows ?? []).filter((r) =>
      (monthlyIncludeInactive || r.status === 'active') &&
      (monthlyType === 'all' || r.store_type === monthlyType) &&
      (monthlyState === 'all' || r.state === monthlyState)
    )
    const dir = monthlySort.dir === 'asc' ? 1 : -1
    const key = monthlySort.key
    return [...rows].sort((a, b) => {
      const va = a[key]
      const vb = b[key]
      // Blanks always sort last, whichever way the column runs
      if (va === null || va === undefined) return vb === null || vb === undefined ? a.store_code.localeCompare(b.store_code) : 1
      if (vb === null || vb === undefined) return -1
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return c * dir || a.store_code.localeCompare(b.store_code)
    })
  }, [monthlyResult, monthlyIncludeInactive, monthlyType, monthlyState, monthlySort])

  function toggleMonthlySort(key: MonthlySortKey, numeric: boolean) {
    setMonthlySort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: numeric ? 'desc' : 'asc' }
    )
  }

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

              {/* Sales by staff */}
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Month</label>
                    <input type="month" value={sbsMonth} onChange={(e) => e.target.value && setSbsMonth(e.target.value)}
                      className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Store</label>
                    <select value={sbsStore} onChange={(e) => setSbsStore(e.target.value)}
                      className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] bg-white max-w-[260px]">
                      <option value="all">All stores</option>
                      {sbsStores.map((st) => (
                        <option key={st.id} value={st.id}>{st.store_code} · {st.store_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-700">Sales by staff</h3>
                  <button
                    onClick={() => exportSalesByStaffCSV(sbsGroups, `sales-by-staff-${sbsMonth}${sbsStore === 'all' ? '' : `-${sbsStores.find((st) => st.id === sbsStore)?.store_code ?? sbsStore}`}.csv`)}
                    disabled={sbsGroups.length === 0}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-40"
                  >
                    <Download size={14} /> Export CSV
                  </button>
                </div>
                {sbsError ? (
                  <p className="text-sm text-red-600">{sbsError}</p>
                ) : sbsLoading ? (
                  <div className="h-32 bg-gray-100 animate-pulse rounded-xl" />
                ) : sbsGroups.length === 0 ? (
                  <p className="text-sm text-gray-400 py-6 text-center">No sales in this month</p>
                ) : sbsGroups.map((group) => (
                  <div key={group.store_id} className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-700">
                      {group.store_code} · {group.store_name}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Keyed in by</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Sales</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Pairs</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">RM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.source + row.label} className="border-b border-gray-50">
                            <td className="px-4 py-2 text-gray-800">
                              {row.label}
                              {row.source === 'admin' && (
                                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Admin login</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right">{row.sales}</td>
                            <td className="px-4 py-2 text-right">{row.pairs}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(row.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-4 py-2">Total</td>
                          <td className="px-4 py-2 text-right">{group.total.sales}</td>
                          <td className="px-4 py-2 text-right">{group.total.pairs}</td>
                          <td className="px-4 py-2 text-right">{formatCurrency(group.total.revenue)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ))}
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

          {/* ── Monthly Average ── */}
          {activeTab === 'monthly' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Months</label>
                  <select value={monthlyMonths} onChange={(e) => setMonthlyMonths(Number(e.target.value) as MonthlyAverageMonths)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] bg-white">
                    {MONTHLY_AVERAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n} {n === 1 ? 'month' : 'months'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Store type</label>
                  <select value={monthlyType} onChange={(e) => setMonthlyType(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] bg-white">
                    <option value="all">All types</option>
                    {monthlyTypeOptions.map((t) => (
                      <option key={t} value={t}>{STORE_TYPE_LABELS[t] || t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">State</label>
                  <select value={monthlyState} onChange={(e) => setMonthlyState(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] bg-white">
                    <option value="all">All states</option>
                    {monthlyStateOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                  <input type="checkbox" checked={monthlyIncludeInactive} onChange={(e) => setMonthlyIncludeInactive(e.target.checked)}
                    className="rounded border-gray-300" />
                  Include inactive stores
                </label>
                <button
                  onClick={() => monthlyResult && exportMonthlyAverageCSV(monthlyRows, monthlyResult.window.months, monthlyResult.window.last_month)}
                  disabled={monthlyRows.length === 0}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-40"
                >
                  <Download size={14} /> CSV
                </button>
              </div>

              {monthlyResult && (
                <p className="text-xs text-gray-500">
                  {monthKeyLabel(monthlyResult.window.month_keys[0])} – {monthKeyLabel(monthlyResult.window.last_month)}
                  {' · '}last {monthlyResult.window.months} full {monthlyResult.window.months === 1 ? 'month' : 'months'}
                  {' · '}current month excluded. Sales (RM) is the average per counted month, from each store&apos;s first recorded sale.
                  {' '}Change compares the last full month with the average of the earlier months in the period
                  {monthlyResult.window.months === 1 ? ' (for 1 month: the month before it)' : ''}.
                </p>
              )}

              {monthlyError ? (
                <p className="text-sm text-red-600">{monthlyError}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        {MONTHLY_COLUMNS.map((col) => {
                          const active = monthlySort.key === col.key
                          const label = col.key === 'last_month_rm' && monthlyResult
                            ? `Last Full Month (RM) · ${monthKeyLabel(monthlyResult.window.last_month)}`
                            : col.label
                          return (
                            <th key={col.key} className={cn('px-4 py-2 text-xs font-semibold text-gray-500 whitespace-nowrap', col.numeric ? 'text-right' : 'text-left')}>
                              <button onClick={() => toggleMonthlySort(col.key, col.numeric)}
                                className={cn('inline-flex items-center gap-1 hover:text-gray-800', active && 'text-gray-900')}>
                                {label}
                                <span className="text-[10px]">{active ? (monthlySort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                              </button>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyLoading ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          {MONTHLY_COLUMNS.map((_, j) => (
                            <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 animate-pulse rounded" /></td>
                          ))}
                        </tr>
                      )) : monthlyRows.map((r) => {
                        const firstWindowMonth = monthlyResult?.window.month_keys[0] ?? ''
                        return (
                          <tr key={r.store_id} className={cn('border-b border-gray-50 hover:bg-gray-50/50', r.status !== 'active' && 'text-gray-400')}>
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{r.store_code}</td>
                            <td className="px-4 py-2.5 font-medium text-gray-800">
                              {r.store_name}
                              {r.status !== 'active' && (
                                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Inactive</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-gray-600 text-xs">{STORE_TYPE_LABELS[r.store_type] || r.store_type}</td>
                            <td className="px-4 py-2.5 text-gray-600">{r.state}</td>
                            <td className={cn('px-4 py-2.5 text-right', r.open_month === null ? 'text-gray-400 text-xs' : 'font-semibold')}>{r.open_month === null ? NO_SALES_YET : r.avg_rm === null ? '—' : formatCurrency(r.avg_rm)}</td>
                            <td className="px-4 py-2.5 text-right">{r.avg_pairs === null ? '—' : r.avg_pairs}</td>
                            <td className="px-4 py-2.5 text-right">{r.months_counted === 0 ? '—' : formatCurrency(r.total_rm)}</td>
                            <td className="px-4 py-2.5 text-right">
                              {r.open_month === null ? '—' : r.months_counted}
                              {r.open_month !== null && r.open_month > firstWindowMonth && (
                                <span className="block text-[10px] text-gray-400">opened {monthKeyLabel(r.open_month)}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">{r.months_counted === 0 ? '—' : formatCurrency(r.last_month_rm)}</td>
                            <td className={cn('px-4 py-2.5 text-right font-semibold',
                              r.change_pct === null ? 'text-gray-400' : r.change_pct >= 0 ? 'text-green-600' : 'text-red-600')}>
                              {r.change_pct === null ? '—' : `${r.change_pct > 0 ? '+' : ''}${r.change_pct.toFixed(1)}%`}
                            </td>
                          </tr>
                        )
                      })}
                      {!monthlyLoading && monthlyRows.length === 0 && (
                        <tr>
                          <td colSpan={MONTHLY_COLUMNS.length} className="px-4 py-10 text-center text-gray-400 text-sm">
                            {monthlyResult ? 'No stores match these filters' : ''}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
