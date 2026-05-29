'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMYDate, getStockStatus } from '@/lib/utils'
import type { StoreInventory, Profile, Sale } from '@/types'
import { cn } from '@/lib/utils'

type FilterTab = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock'

export default function InventoryPage() {
  const [inventory, setInventory] = useState<StoreInventory[]>([])
  const [monthlySales, setMonthlySales] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  async function load() {
    setLoading(true)
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('store_id')
      .eq('id', user.id)
      .single<Profile>()

    if (!profile?.store_id) { setLoading(false); return }

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [invRes, salesRes] = await Promise.all([
      supabase
        .from('store_inventory')
        .select('*, product:products(*)')
        .eq('store_id', profile.store_id)
        .order('quantity_on_hand', { ascending: true }),
      supabase
        .from('sales')
        .select('product_id, quantity')
        .eq('store_id', profile.store_id)
        .gte('sale_date', firstOfMonth),
    ])

    const inv = (invRes.data as StoreInventory[]) ?? []
    setInventory(inv)

    // Aggregate monthly sales per product
    const salesMap: Record<string, number> = {}
    for (const s of (salesRes.data as Pick<Sale, 'product_id' | 'quantity'>[]) ?? []) {
      salesMap[s.product_id] = (salesMap[s.product_id] ?? 0) + s.quantity
    }
    setMonthlySales(salesMap)
    setLastUpdated(new Date())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = inventory.filter((item) => {
    if (filter === 'all') return true
    return getStockStatus(item.quantity_on_hand, item.restock_threshold) === filter
  })

  const totalPairs = inventory.reduce((s, i) => s + i.quantity_on_hand, 0)
  const totalValue = inventory.reduce((s, i) => s + (i.product?.cost_price ?? 0) * i.quantity_on_hand, 0)

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: inventory.length },
    {
      key: 'in_stock',
      label: 'In Stock',
      count: inventory.filter((i) => getStockStatus(i.quantity_on_hand, i.restock_threshold) === 'in_stock').length,
    },
    {
      key: 'low_stock',
      label: 'Low Stock',
      count: inventory.filter((i) => getStockStatus(i.quantity_on_hand, i.restock_threshold) === 'low_stock').length,
    },
    {
      key: 'out_of_stock',
      label: 'Out of Stock',
      count: inventory.filter((i) => i.quantity_on_hand === 0).length,
    },
  ]

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0A0A0A]">My Inventory</h1>
          {lastUpdated && (
            <p className="text-xs text-gray-400 mt-0.5">
              Updated {lastUpdated.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 snap-x">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              'snap-start shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
              filter === tab.key
                ? 'bg-[#0A0A0A] text-[#FFD700]'
                : 'bg-white text-gray-600 border border-gray-200',
            )}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={cn('ml-1', filter === tab.key ? 'text-[#FFD700]/70' : 'text-gray-400')}>
                ({tab.count})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="flex justify-between">
                <div className="h-4 bg-gray-200 rounded w-2/5" />
                <div className="h-8 bg-gray-200 rounded w-12" />
              </div>
              <div className="h-3 bg-gray-200 rounded w-1/3 mt-2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No items match this filter.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const status = getStockStatus(item.quantity_on_hand, item.restock_threshold)
            const unitsSold = monthlySales[item.product_id] ?? 0

            return (
              <div key={item.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* Product image thumbnail */}
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                    {item.product?.image_url ? (
                      <Image
                        src={item.product.image_url}
                        alt={item.product.name ?? ''}
                        width={48}
                        height={48}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="text-xs font-black text-gray-300 select-none">
                        {item.product?.sku?.slice(0, 3) ?? '?'}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#0A0A0A] truncate">{item.product?.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{item.product?.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-3xl font-bold text-[#0A0A0A]">{item.quantity_on_hand}</p>
                    <p className="text-xs text-gray-400">pairs</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {/* Status badge */}
                  <span
                    className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full',
                      status === 'in_stock' && 'bg-green-100 text-green-700',
                      status === 'low_stock' && 'bg-amber-100 text-amber-700',
                      status === 'out_of_stock' && 'bg-red-100 text-red-600',
                    )}
                  >
                    {status === 'in_stock' && 'In Stock'}
                    {status === 'low_stock' && 'Low Stock'}
                    {status === 'out_of_stock' && 'Out of Stock'}
                  </span>

                  <span className="text-xs text-gray-400">
                    Restock at: <span className="font-medium text-gray-600">{item.restock_threshold}</span>
                  </span>

                  {unitsSold > 0 && (
                    <span className="text-xs text-gray-400">
                      Sold this month: <span className="font-medium text-gray-600">{unitsSold}</span>
                    </span>
                  )}
                </div>

                {item.last_restocked_at && (
                  <p className="mt-2 text-xs text-gray-400">
                    Last restocked: {formatMYDate(item.last_restocked_at)}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Summary bar */}
      {!loading && inventory.length > 0 && (
        <div className="bg-[#0A0A0A] rounded-xl p-4 flex justify-between items-center">
          <div>
            <p className="text-xs text-gray-400">Total Pairs on Hand</p>
            <p className="text-2xl font-bold text-[#FFD700]">{totalPairs}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Est. Cost Value</p>
            <p className="text-base font-bold text-white">{formatCurrency(totalValue)}</p>
          </div>
        </div>
      )}
    </div>
  )
}
