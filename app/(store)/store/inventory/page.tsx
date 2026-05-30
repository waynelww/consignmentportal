'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, getStockStatus } from '@/lib/utils'
import type { StoreInventory, Sale } from '@/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/components/store/StoreContext'

type FilterTab = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock'

export default function InventoryPage() {
  const { storeId } = useStore()
  const [inventory, setInventory] = useState<StoreInventory[]>([])
  const [monthlySales, setMonthlySales] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  async function load() {
    if (!storeId) return
    setLoading(true)
    const supabase = createClient()

    // storeId from context — no auth waterfall needed
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
    const pad = (n: number) => String(n).padStart(2, '0')
    const firstOfMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

    const [invRes, salesRes] = await Promise.all([
      supabase
        .from('store_inventory')
        .select('*, product:products(*)')
        .eq('store_id', storeId)
        .order('quantity_on_hand', { ascending: true }),
      supabase
        .from('sales')
        .select('product_id, quantity')
        .eq('store_id', storeId)
        .gte('sale_date', firstOfMonth)
        .lte('sale_date', todayStr),
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

  useEffect(() => { load() }, [storeId]) // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Grid — 3 per row for fast scanning */}
      {loading ? (
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm overflow-hidden animate-pulse">
              <div className="aspect-square bg-gray-200" />
              <div className="p-2 space-y-1.5">
                <div className="h-3 bg-gray-200 rounded w-3/4" />
                <div className="h-2 bg-gray-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No items match this filter.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {filtered.map((item) => {
            const status = getStockStatus(item.quantity_on_hand, item.restock_threshold)
            const unitsSold = monthlySales[item.product_id] ?? 0

            return (
              <div key={item.id} className="relative bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Image */}
                <div className="relative aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                  {item.product?.image_url ? (
                    <Image
                      src={item.product.image_url}
                      alt={item.product.name ?? ''}
                      width={120}
                      height={120}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="text-2xl font-black text-gray-200 select-none">
                      {item.product?.sku?.slice(0, 3) ?? '?'}
                    </span>
                  )}
                  {/* Status badge overlay */}
                  {status !== 'in_stock' && (
                    <span
                      className={cn(
                        'absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm',
                        status === 'low_stock' && 'bg-amber-500 text-white',
                        status === 'out_of_stock' && 'bg-red-500 text-white',
                      )}
                    >
                      {status === 'low_stock' ? 'LOW' : 'OUT'}
                    </span>
                  )}
                  {/* Quantity badge in corner */}
                  <span
                    className={cn(
                      'absolute bottom-1.5 right-1.5 min-w-[28px] h-7 px-1.5 rounded-lg flex items-center justify-center text-sm font-bold shadow-md',
                      status === 'out_of_stock' ? 'bg-red-500 text-white' : 'bg-[#0A0A0A] text-[#FFD700]',
                    )}
                  >
                    {item.quantity_on_hand}
                  </span>
                </div>

                {/* Info */}
                <div className="p-2">
                  <p className="text-xs font-bold text-[#0A0A0A] leading-tight line-clamp-2">
                    {item.product?.name}
                  </p>
                  <p className="text-[10px] font-mono text-gray-400 truncate mt-0.5">{item.product?.sku}</p>
                  {unitsSold > 0 && (
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      <span className="font-semibold">{unitsSold}</span> sold
                    </p>
                  )}
                </div>
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
