'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Search, Plus, Download, ChevronLeft, ChevronRight, Eye, Edit, ToggleLeft, ToggleRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatMYDate, formatCurrency, MALAYSIAN_STATES, STORE_TYPE_LABELS, cn } from '@/lib/utils'
import type { Store, StoreStatus, StoreType } from '@/types'
import { toast } from 'sonner'

const PAGE_SIZE = 25

function StatusBadge({ status }: { status: StoreStatus }) {
  const map: Record<StoreStatus, string> = {
    active: 'bg-green-100 text-green-700',
    inactive: 'bg-gray-100 text-gray-600',
    suspended: 'bg-red-100 text-red-700',
    pending: 'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium capitalize', map[status])}>
      {status}
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 50 ? 'text-green-600' : score >= 20 ? 'text-amber-600' : 'text-red-600'
  return <span className={cn('font-semibold text-sm', color)}>{score}</span>
}

interface StoreRow extends Store {
  pairs_mtd: number
  last_sale: string | null
}

export default function StoresPage() {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const supabase = createClient()

  const fetchStores = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('stores')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) {
      query = query.or(
        `store_name.ilike.%${search}%,pic_name.ilike.%${search}%,store_code.ilike.%${search}%,city.ilike.%${search}%`
      )
    }
    if (stateFilter) query = query.eq('state', stateFilter)
    if (typeFilter) query = query.eq('store_type', typeFilter)
    if (statusFilter) query = query.eq('status', statusFilter)

    const { data, count } = await query
    const storeList = (data || []) as Store[]
    setTotal(count || 0)

    // Get MTD sales and last sale for each store
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const ids = storeList.map((s) => s.id)

    if (ids.length === 0) {
      setStores([])
      setLoading(false)
      return
    }

    const [{ data: salesData }, { data: lastSaleData }] = await Promise.all([
      supabase
        .from('sales')
        .select('store_id, quantity')
        .in('store_id', ids)
        .gte('sale_date', startOfMonth),
      supabase
        .from('sales')
        .select('store_id, sale_date')
        .in('store_id', ids)
        .order('sale_date', { ascending: false }),
    ])

    const pairsMap: Record<string, number> = {}
    for (const s of salesData || []) {
      pairsMap[s.store_id] = (pairsMap[s.store_id] || 0) + s.quantity
    }

    const lastSaleMap: Record<string, string> = {}
    for (const s of lastSaleData || []) {
      if (!lastSaleMap[s.store_id]) lastSaleMap[s.store_id] = s.sale_date
    }

    setStores(
      storeList.map((s) => ({
        ...s,
        pairs_mtd: pairsMap[s.id] || 0,
        last_sale: lastSaleMap[s.id] || null,
      }))
    )
    setLoading(false)
  }, [page, search, stateFilter, typeFilter, statusFilter])

  useEffect(() => {
    fetchStores()
  }, [fetchStores])

  // Reset page on filter change
  useEffect(() => {
    setPage(0)
  }, [search, stateFilter, typeFilter, statusFilter])

  async function toggleStatus(store: StoreRow) {
    const newStatus: StoreStatus = store.status === 'active' ? 'inactive' : 'active'
    const confirmed = window.confirm(
      `${newStatus === 'inactive' ? 'Deactivate' : 'Activate'} "${store.store_name}"?`
    )
    if (!confirmed) return
    const { error } = await supabase
      .from('stores')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', store.id)
    if (error) {
      toast.error('Failed to update status')
    } else {
      toast.success(`Store ${newStatus === 'active' ? 'activated' : 'deactivated'}`)
      fetchStores()
    }
  }

  async function exportCSV() {
    let query = supabase.from('stores').select('*').order('store_name')
    if (search)
      query = query.or(
        `store_name.ilike.%${search}%,pic_name.ilike.%${search}%,store_code.ilike.%${search}%,city.ilike.%${search}%`
      )
    if (stateFilter) query = query.eq('state', stateFilter)
    if (typeFilter) query = query.eq('store_type', typeFilter)
    if (statusFilter) query = query.eq('status', statusFilter)

    const { data } = await query
    if (!data || data.length === 0) {
      toast.error('No data to export')
      return
    }

    const headers = [
      'Store Code', 'Store Name', 'PIC', 'Phone', 'Email', 'City', 'State',
      'Type', 'Status', 'Performance Score', 'Commission Rate',
    ]
    const rows = data.map((s: Store) => [
      s.store_code,
      s.store_name,
      s.pic_name,
      s.pic_phone,
      s.email || '',
      s.city,
      s.state,
      STORE_TYPE_LABELS[s.store_type] || s.store_type,
      s.status,
      s.performance_score,
      s.commission_rate,
    ])

    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stores-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exported')
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500">{total} store{total !== 1 ? 's' : ''} found</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Download size={16} />
            Export CSV
          </button>
          <Link
            href="/stores/new"
            className="flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
          >
            <Plus size={16} />
            Add New Store
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search store name, PIC, code, city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          >
            <option value="">All States</option>
            {MALAYSIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          >
            <option value="">All Types</option>
            {Object.entries(STORE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Store Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">PIC</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">City / State</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Score</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Units MTD</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Sale</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : stores.map((store) => (
                    <tr key={store.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{store.store_code}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{store.store_name}</td>
                      <td className="px-4 py-3 text-gray-600">{store.pic_name}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {store.city}, {store.state}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {STORE_TYPE_LABELS[store.store_type] || store.store_type}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={store.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ScoreBadge score={store.performance_score} />
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">
                        {store.pairs_mtd}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {store.last_sale ? formatMYDate(store.last_sale) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/stores/${store.id}`}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            title="View"
                          >
                            <Eye size={15} />
                          </Link>
                          <Link
                            href={`/stores/${store.id}?tab=overview`}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit size={15} />
                          </Link>
                          <button
                            onClick={() => toggleStatus(store)}
                            className={cn(
                              'p-1.5 rounded-lg transition-colors',
                              store.status === 'active'
                                ? 'text-green-500 hover:bg-green-50'
                                : 'text-gray-400 hover:bg-gray-100'
                            )}
                            title={store.status === 'active' ? 'Deactivate' : 'Activate'}
                          >
                            {store.status === 'active' ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              {!loading && stores.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No stores found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-3 py-1 text-xs font-medium text-gray-600">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
