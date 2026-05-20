'use client'

import { useEffect, useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn, PRODUCT_CATEGORY_LABELS } from '@/lib/utils'
import type { Product, Store } from '@/types'
import { toast } from 'sonner'

interface ProductStockRow {
  product: Product
  total_deployed: number
  stores_stocking: number
  avg_per_store: number
  low_stock_stores: number
  store_breakdown: Array<{
    store_id: string
    store_name: string
    city: string
    quantity_on_hand: number
    threshold: number
  }>
  expanded: boolean
}

interface WarehouseRow {
  product: Product
  quantity: number
  editing: boolean
  editValue: number
}

export default function StockPage() {
  const [rows, setRows] = useState<ProductStockRow[]>([])
  const [warehouse, setWarehouse] = useState<WarehouseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [totalDeployed, setTotalDeployed] = useState(0)
  const [lowStockStores, setLowStockStores] = useState(0)
  const [totalSKUs, setTotalSKUs] = useState(0)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    setLoading(true)

    const [{ data: productsData }, { data: invData }, { data: warehouseData }] = await Promise.all([
      supabase.from('products').select('*').eq('is_active', true).order('sku'),
      supabase.from('store_inventory').select('*, store:stores(id, store_name, city)'),
      supabase.from('warehouse_stock').select('*'),
    ])

    const products = (productsData || []) as Product[]

    type InvRow = {
      product_id: string
      quantity_on_hand: number
      restock_threshold: number
      store: { id: string; store_name: string; city: string } | null
    }
    const inventory = (invData || []) as InvRow[]

    // Build product rows
    const productMap: Record<string, ProductStockRow> = {}
    for (const p of products) {
      productMap[p.id] = {
        product: p,
        total_deployed: 0,
        stores_stocking: 0,
        avg_per_store: 0,
        low_stock_stores: 0,
        store_breakdown: [],
        expanded: false,
      }
    }

    const lowStoreSet = new Set<string>()
    for (const inv of inventory) {
      const row = productMap[inv.product_id]
      if (!row) continue
      row.total_deployed += inv.quantity_on_hand
      if (inv.quantity_on_hand > 0) row.stores_stocking++
      if (inv.quantity_on_hand <= inv.restock_threshold) {
        row.low_stock_stores++
        if (inv.store?.id) lowStoreSet.add(inv.store.id)
      }
      if (inv.store) {
        row.store_breakdown.push({
          store_id: inv.store.id,
          store_name: inv.store.store_name,
          city: inv.store.city,
          quantity_on_hand: inv.quantity_on_hand,
          threshold: inv.restock_threshold,
        })
      }
    }

    for (const row of Object.values(productMap)) {
      row.avg_per_store = row.stores_stocking > 0
        ? Math.round(row.total_deployed / row.stores_stocking)
        : 0
    }

    const stockRows = Object.values(productMap)
    setRows(stockRows)
    setTotalDeployed(stockRows.reduce((a, r) => a + r.total_deployed, 0))
    setLowStockStores(lowStoreSet.size)
    setTotalSKUs(products.length)

    // Warehouse rows
    const whMap: Record<string, number> = {}
    for (const w of warehouseData || []) {
      whMap[w.product_id] = w.quantity
    }
    setWarehouse(
      products.map((p) => ({
        product: p,
        quantity: whMap[p.id] || 0,
        editing: false,
        editValue: whMap[p.id] || 0,
      }))
    )

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleExpand(productId: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.product.id === productId ? { ...r, expanded: !r.expanded } : r
      )
    )
  }

  function startEdit(productId: string) {
    setWarehouse((prev) =>
      prev.map((r) =>
        r.product.id === productId ? { ...r, editing: true } : r
      )
    )
  }

  async function saveWarehouse(productId: string) {
    const row = warehouse.find((r) => r.product.id === productId)
    if (!row) return

    const { error } = await supabase
      .from('warehouse_stock')
      .upsert({ product_id: productId, quantity: row.editValue, updated_at: new Date().toISOString() })
      .eq('product_id', productId)

    if (error) {
      toast.error('Failed to save')
    } else {
      toast.success('Warehouse stock updated')
      setWarehouse((prev) =>
        prev.map((r) =>
          r.product.id === productId
            ? { ...r, quantity: r.editValue, editing: false }
            : r
        )
      )
    }
  }

  function updateEditValue(productId: string, value: number) {
    setWarehouse((prev) =>
      prev.map((r) =>
        r.product.id === productId ? { ...r, editValue: Math.max(0, value) } : r
      )
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Pairs Deployed', value: loading ? '—' : totalDeployed.toLocaleString(), color: 'bg-blue-500' },
          { label: 'Stores with Low Stock', value: loading ? '—' : lowStockStores.toString(), color: 'bg-amber-500' },
          { label: 'Total Active SKUs', value: loading ? '—' : totalSKUs.toString(), color: 'bg-green-500' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className={cn('w-2 h-6 rounded-full mb-3', card.color)} />
            <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            <p className="text-xs text-gray-500 mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Product Distribution */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Product Distribution</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Product</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">SKU</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Deployed</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Stores</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg/Store</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Low Stock</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500" />
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => (
                    <>
                      <tr
                        key={row.product.id}
                        className={cn(
                          'border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer',
                          row.expanded && 'bg-gray-50'
                        )}
                        onClick={() => toggleExpand(row.product.id)}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {row.product.name}
                          <span className="ml-2 text-xs text-gray-400">
                            {PRODUCT_CATEGORY_LABELS[row.product.category]}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.product.sku}</td>
                        <td className="px-4 py-3 text-right font-semibold">{row.total_deployed}</td>
                        <td className="px-4 py-3 text-right">{row.stores_stocking}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{row.avg_per_store}</td>
                        <td className="px-4 py-3 text-right">
                          {row.low_stock_stores > 0 ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                              {row.low_stock_stores}
                            </span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">
                          {row.expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </td>
                      </tr>
                      {row.expanded && (
                        <tr key={`${row.product.id}-expand`} className="bg-gray-50 border-b border-gray-100">
                          <td colSpan={7} className="px-6 py-3">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400">
                                    <th className="text-left py-1 pr-4">Store</th>
                                    <th className="text-left py-1 pr-4">City</th>
                                    <th className="text-right py-1 pr-4">On Hand</th>
                                    <th className="text-right py-1">Threshold</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.store_breakdown.map((sb) => (
                                    <tr key={sb.store_id} className="border-t border-gray-100">
                                      <td className="py-1.5 pr-4 text-gray-700">{sb.store_name}</td>
                                      <td className="py-1.5 pr-4 text-gray-500">{sb.city}</td>
                                      <td className={cn(
                                        'py-1.5 pr-4 text-right font-medium',
                                        sb.quantity_on_hand <= sb.threshold ? 'text-amber-600' : 'text-gray-800'
                                      )}>
                                        {sb.quantity_on_hand}
                                      </td>
                                      <td className="py-1.5 text-right text-gray-500">{sb.threshold}</td>
                                    </tr>
                                  ))}
                                  {row.store_breakdown.length === 0 && (
                                    <tr>
                                      <td colSpan={4} className="py-3 text-center text-gray-400">
                                        No stores stocking this product
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Warehouse Stock */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Warehouse Stock</h2>
          <p className="text-xs text-gray-500 mt-0.5">Click quantity to edit</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Product</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Qty in Warehouse</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : warehouse.map((row) => (
                    <tr key={row.product.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.product.sku}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{row.product.name}</td>
                      <td className="px-4 py-3 text-right">
                        {row.editing ? (
                          <input
                            type="number"
                            min={0}
                            value={row.editValue}
                            onChange={(e) => updateEditValue(row.product.id, Number(e.target.value))}
                            className="w-24 px-2 py-1 text-sm border border-[#FFD700] rounded-lg focus:outline-none text-right ml-auto block"
                            autoFocus
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:bg-gray-100 px-2 py-1 rounded"
                            onClick={() => startEdit(row.product.id)}
                          >
                            {row.quantity}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.editing && (
                          <button
                            onClick={() => saveWarehouse(row.product.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0A0A0A] text-white text-xs rounded-lg hover:bg-gray-800 transition-colors ml-auto"
                          >
                            <Save size={13} />
                            Save
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
