'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Check, RotateCcw, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn, PRODUCT_CATEGORY_LABELS } from '@/lib/utils'
import type { Product } from '@/types'
import { toast } from 'sonner'

interface ProductStockRow {
  product: Product
  total_deployed: number
  stores_stocking: number
  low_stock_stores: number
  store_breakdown: Array<{
    store_id: string
    store_name: string
    city: string
    quantity_on_hand: number
    threshold: number
  }>
  expanded: boolean
  office_quantity: number
  office_delta: number
  office_saving: boolean
}

export default function StockPage() {
  const [rows, setRows] = useState<ProductStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [totalDeployed, setTotalDeployed] = useState(0)
  const [lowStockStores, setLowStockStores] = useState(0)
  const [totalSKUs, setTotalSKUs] = useState(0)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    setLoading(true)

    const [{ data: productsData }, { data: invData }, { data: warehouseData, error: whErr }] = await Promise.all([
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

    const whMap: Record<string, number> = {}
    for (const w of warehouseData || []) whMap[w.product_id] = w.quantity
    if (whErr) {
      // Table missing/misconfigured — surface it rather than silently showing all zeros
      toast.error('Warehouse stock could not be loaded (table missing?)')
    }

    // Build product rows
    const productMap: Record<string, ProductStockRow> = {}
    for (const p of products) {
      productMap[p.id] = {
        product: p,
        total_deployed: 0,
        stores_stocking: 0,
        low_stock_stores: 0,
        store_breakdown: [],
        expanded: false,
        office_quantity: whMap[p.id] || 0,
        office_delta: 0,
        office_saving: false,
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

    // Least stock first — the stores that need attention surface at the top
    for (const row of Object.values(productMap)) {
      row.store_breakdown.sort((a, b) => a.quantity_on_hand - b.quantity_on_hand)
    }

    const stockRows = Object.values(productMap)
    setRows(stockRows)
    setTotalDeployed(stockRows.reduce((a, r) => a + r.total_deployed, 0))
    setLowStockStores(lowStoreSet.size)
    setTotalSKUs(products.length)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleExpand(productId: string) {
    setRows((prev) =>
      prev.map((r) => r.product.id === productId ? { ...r, expanded: !r.expanded } : r)
    )
  }

  function adjustOffice(productId: string, delta: number) {
    setRows((prev) =>
      prev.map((r) => r.product.id === productId ? { ...r, office_delta: r.office_delta + delta } : r)
    )
  }

  function setOfficeDelta(productId: string, delta: number) {
    setRows((prev) =>
      prev.map((r) => r.product.id === productId ? { ...r, office_delta: delta } : r)
    )
  }

  function resetOfficeDelta(productId: string) {
    setRows((prev) =>
      prev.map((r) => r.product.id === productId ? { ...r, office_delta: 0 } : r)
    )
  }

  async function confirmOffice(productId: string) {
    const row = rows.find((r) => r.product.id === productId)
    if (!row || row.office_delta === 0) return

    const newQty = Math.max(0, row.office_quantity + row.office_delta)
    setRows((prev) => prev.map((r) => r.product.id === productId ? { ...r, office_saving: true } : r))

    const { error } = await supabase
      .from('warehouse_stock')
      .upsert({ product_id: productId, quantity: newQty, updated_at: new Date().toISOString() })

    if (error) {
      toast.error('Failed to update office stock')
      setRows((prev) => prev.map((r) => r.product.id === productId ? { ...r, office_saving: false } : r))
    } else {
      toast.success('Office stock updated')
      setRows((prev) =>
        prev.map((r) =>
          r.product.id === productId
            ? { ...r, office_quantity: newQty, office_delta: 0, office_saving: false }
            : r
        )
      )
    }
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

      {/* Product Distribution + Office Stock */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Product Distribution &amp; Office Stock</h2>
          <p className="text-xs text-gray-500 mt-0.5">Click a row to see the per-store breakdown. Adjust office stock with +/− then confirm.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Product</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">SKU</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Stores</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Deployed</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Low Stock</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Office Stock</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-48">Edit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500" />
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {Array.from({ length: 8 }).map((_, j) => (
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
                          'border-b border-gray-50 hover:bg-gray-50/50',
                          row.expanded && 'bg-gray-50'
                        )}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.product.name}
                          <span className="ml-2 text-xs text-gray-400">
                            {PRODUCT_CATEGORY_LABELS[row.product.category]}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.product.sku}
                        </td>
                        <td className="px-4 py-3 text-right cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.stores_stocking}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.total_deployed}
                        </td>
                        <td className="px-4 py-3 text-right cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.low_stock_stores > 0 ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                              {row.low_stock_stores}
                            </span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        {/* Office Stock — plain display of the committed quantity, never changes until Confirm */}
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                          {row.office_quantity}
                        </td>

                        {/* Edit — separate column, this is the only place adjustments happen */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col gap-1.5">
                            <div className="inline-flex items-center border border-gray-200 rounded-lg overflow-hidden w-fit">
                              <button
                                type="button"
                                onClick={() => adjustOffice(row.product.id, row.office_delta - 1)}
                                disabled={row.office_saving}
                                className="w-7 h-7 flex items-center justify-center text-gray-600 text-sm font-bold hover:bg-gray-100 disabled:opacity-40"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                value={row.office_delta}
                                onChange={(e) => setOfficeDelta(row.product.id, parseInt(e.target.value, 10) || 0)}
                                disabled={row.office_saving}
                                className="w-14 h-7 text-center text-xs border-x border-gray-200 outline-none tabular-nums"
                              />
                              <button
                                type="button"
                                onClick={() => adjustOffice(row.product.id, row.office_delta + 1)}
                                disabled={row.office_saving}
                                className="w-7 h-7 flex items-center justify-center text-gray-600 text-sm font-bold hover:bg-gray-100 disabled:opacity-40"
                              >
                                +
                              </button>
                            </div>
                            {row.office_delta !== 0 && (
                              <div className="flex items-center gap-1.5">
                                <span className={cn(
                                  'text-[11px] font-semibold tabular-nums',
                                  row.office_delta > 0 ? 'text-green-600' : 'text-red-600'
                                )}>
                                  → {Math.max(0, row.office_quantity + row.office_delta)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => confirmOffice(row.product.id)}
                                  disabled={row.office_saving}
                                  title="Confirm"
                                  className="w-6 h-6 rounded-md bg-green-600 text-white flex items-center justify-center hover:bg-green-700 disabled:opacity-40 shrink-0"
                                >
                                  {row.office_saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => resetOfficeDelta(row.product.id)}
                                  disabled={row.office_saving}
                                  title="Reset"
                                  className="w-6 h-6 rounded-md bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 disabled:opacity-40 shrink-0"
                                >
                                  <RotateCcw size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-right text-gray-400 cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </td>
                      </tr>
                      {row.expanded && (
                        <tr key={`${row.product.id}-expand`} className="bg-gray-50 border-b border-gray-100">
                          <td colSpan={8} className="px-6 py-3">
                            <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-gray-100 bg-white">
                              <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-gray-50">
                                  <tr className="text-gray-400">
                                    <th className="text-left py-2 px-3">Store</th>
                                    <th className="text-left py-2 px-3">City</th>
                                    <th className="text-right py-2 px-3">On Hand</th>
                                    <th className="text-right py-2 px-3">Threshold</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.store_breakdown.map((sb) => (
                                    <tr key={sb.store_id} className="border-t border-gray-100">
                                      <td className="py-1.5 px-3">
                                        <Link
                                          href={`/admin/stores/${sb.store_id}?tab=overview`}
                                          className="text-blue-700 hover:underline font-medium"
                                        >
                                          {sb.store_name}
                                        </Link>
                                      </td>
                                      <td className="py-1.5 px-3 text-gray-500">{sb.city}</td>
                                      <td className={cn(
                                        'py-1.5 px-3 text-right font-medium',
                                        sb.quantity_on_hand <= sb.threshold ? 'text-amber-600' : 'text-gray-800'
                                      )}>
                                        {sb.quantity_on_hand}
                                      </td>
                                      <td className="py-1.5 px-3 text-right text-gray-500">{sb.threshold}</td>
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
    </div>
  )
}
