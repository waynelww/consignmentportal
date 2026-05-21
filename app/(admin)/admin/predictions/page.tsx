'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sparkles, TrendingUp, RefreshCw, Package, Store, ChevronDown, ChevronRight, Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import Link from 'next/link'

interface Suggestion {
  store_id: string
  store_name: string
  store_code: string
  product_id: string
  product_name: string
  sku: string
  avg_monthly_sales: number
  projected_demand: number
  current_stock: number
  suggested_restock: number
  seasonal_multiplier: number
  festivals: string[]
}

interface PredictionResult {
  target_month: number
  target_year: number
  seasonal_multiplier: number
  festivals: string[]
  suggestions: Suggestion[]
  generated_at: string
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export default function PredictionsPage() {
  const [result, setResult] = useState<PredictionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState<{ id: string; store_name: string }[]>([])
  const [selectedStore, setSelectedStore] = useState('')
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set())

  const load = useCallback(async (storeId = '') => {
    setLoading(true)
    try {
      const url = storeId ? `/api/restock/predictions?store_id=${storeId}` : '/api/restock/predictions'
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to load predictions')
        setLoading(false)
        return
      }
      const data: PredictionResult = await res.json()
      setResult(data)
      // Auto-expand all stores
      const storeIds = [...new Set(data.suggestions.map((s) => s.store_id))]
      setExpandedStores(new Set(storeIds))
    } catch (e) {
      toast.error('Network error')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.from('stores').select('id, store_name').eq('status', 'active').order('store_name').then(({ data }) => {
      setStores(data ?? [])
    })
    load()
  }, [load])

  function toggleStore(storeId: string) {
    setExpandedStores((prev) => {
      const next = new Set(prev)
      if (next.has(storeId)) next.delete(storeId)
      else next.add(storeId)
      return next
    })
  }

  const groupedByStore = result
    ? result.suggestions.reduce<Record<string, Suggestion[]>>((acc, s) => {
        if (!acc[s.store_id]) acc[s.store_id] = []
        acc[s.store_id].push(s)
        return acc
      }, {})
    : {}

  const totalSuggested = result?.suggestions.reduce((s, x) => s + x.suggested_restock, 0) ?? 0

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0A0A0A] flex items-center gap-2">
            <Sparkles size={22} className="text-[#FFD700]" />
            Restock Predictions
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            AI-assisted suggestions based on past sales trends and seasonal demand. Review and create DOs manually.
          </p>
        </div>
        <button
          onClick={() => load(selectedStore)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={15} className={cn(loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={selectedStore}
          onChange={(e) => { setSelectedStore(e.target.value); load(e.target.value) }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
        >
          <option value="">All Stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.store_name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-5 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-1/4 mb-3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : result ? (
        <>
          {/* Summary banner */}
          <div className="bg-[#0A0A0A] rounded-xl p-5 text-white">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-400 text-xs mb-0.5">Projection for</p>
                <p className="text-xl font-bold text-[#FFD700]">
                  {MONTH_NAMES[result.target_month]} {result.target_year}
                </p>
                {result.festivals.length > 0 && (
                  <p className="text-sm text-gray-300 mt-1">
                    🎉 {result.festivals.join(', ')} — demand boosted ×{result.seasonal_multiplier.toFixed(2)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-xs">Total pairs to restock</p>
                <p className="text-3xl font-bold text-white">{totalSuggested}</p>
                <p className="text-xs text-gray-400 mt-0.5">{Object.keys(groupedByStore).length} stores · {result.suggestions.length} SKUs</p>
              </div>
            </div>
          </div>

          {result.suggestions.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-10 text-center">
              <TrendingUp size={36} className="text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No restock needed — all stores have sufficient stock for next month.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedByStore).map(([storeId, items]) => {
                const isExpanded = expandedStores.has(storeId)
                const storeTotalPairs = items.reduce((s, x) => s + x.suggested_restock, 0)
                const { store_name, store_code } = items[0]

                return (
                  <div key={storeId} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                    {/* Store header row */}
                    <button
                      onClick={() => toggleStore(storeId)}
                      className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Store size={16} className="text-gray-400" />
                        <div className="text-left">
                          <p className="text-sm font-semibold text-gray-900">{store_name}</p>
                          <p className="text-xs text-gray-400 font-mono">{store_code}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-gray-400">Total pairs needed</p>
                          <p className="text-base font-bold text-[#0A0A0A]">{storeTotalPairs}</p>
                        </div>
                        <Link
                          href={`/admin/delivery-orders?store_id=${storeId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0A0A0A] text-[#FFD700] rounded-lg text-xs font-semibold hover:bg-gray-800 transition-colors"
                        >
                          <Truck size={12} />
                          Create DO
                        </Link>
                        {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                      </div>
                    </button>

                    {/* Items table */}
                    {isExpanded && (
                      <div className="border-t border-gray-100">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                              <th className="text-left px-5 py-2.5">Product / SKU</th>
                              <th className="text-right px-4 py-2.5">Avg/Month</th>
                              <th className="text-right px-4 py-2.5">Projected</th>
                              <th className="text-right px-4 py-2.5">In Stock</th>
                              <th className="text-right px-5 py-2.5 text-[#0A0A0A] font-bold">Suggest</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => (
                              <tr key={item.product_id} className="border-t border-gray-50 hover:bg-gray-50/50">
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-2">
                                    <Package size={13} className="text-gray-400 shrink-0" />
                                    <div>
                                      <p className="text-gray-900 font-medium">{item.product_name}</p>
                                      <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right text-gray-600">{item.avg_monthly_sales}</td>
                                <td className="px-4 py-3 text-right text-gray-600">{item.projected_demand}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className={cn(
                                    'font-medium',
                                    item.current_stock === 0 ? 'text-red-600' :
                                    item.current_stock < item.avg_monthly_sales ? 'text-amber-600' : 'text-gray-600'
                                  )}>
                                    {item.current_stock}
                                  </span>
                                </td>
                                <td className="px-5 py-3 text-right">
                                  <span className="inline-block bg-[#FFD700] text-[#0A0A0A] font-bold px-2.5 py-0.5 rounded-full text-sm">
                                    +{item.suggested_restock}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-xs text-gray-400 text-center">
            Generated at {new Date(result.generated_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })} MYT ·
            Based on last 3 months of sales data ·  These are suggestions only — review before creating DOs
          </p>
        </>
      ) : null}
    </div>
  )
}
