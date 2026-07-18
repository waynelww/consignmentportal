'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Check, RotateCcw, Loader2, History, X } from 'lucide-react'
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

interface WarehouseMovement {
  id: string
  delta: number
  quantity_before: number
  quantity_after: number
  reason: string
  reference_type: string | null
  created_at: string
  created_by_profile: { full_name: string } | null
}

export default function StockPage() {
  const [rows, setRows] = useState<ProductStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [totalDeployed, setTotalDeployed] = useState(0)
  const [lowStockStores, setLowStockStores] = useState(0)
  const [totalSKUs, setTotalSKUs] = useState(0)
  const [reasonModal, setReasonModal] = useState<{ productId: string; delta: number; newQty: number } | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [reasonSaving, setReasonSaving] = useState(false)
  const [historyModal, setHistoryModal] = useState<{ productId: string; productName: string } | null>(null)
  const [historyItems, setHistoryItems] = useState<WarehouseMovement[] | null>(null)
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

  // Guards against the classic <input type="number"> footgun: scrolling the
  // page while the field has focus makes Chrome silently step the value on
  // every wheel tick, which can dump thousands into the delta in an instant.
  const MAX_DELTA = 9999
  const clampDelta = (n: number) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, n))

  function adjustOffice(productId: string, delta: number) {
    setRows((prev) =>
      prev.map((r) => r.product.id === productId ? { ...r, office_delta: clampDelta(r.office_delta + delta) } : r)
    )
  }

  function setOfficeDelta(productId: string, delta: number) {
    setRows((prev) =>
      prev.map((r) => r.product.id === productId ? { ...r, office_delta: clampDelta(delta) } : r)
    )
  }

  function resetOfficeDelta(productId: string) {
    setRows((prev) =>
      prev.map((r) => r.product.id === productId ? { ...r, office_delta: 0 } : r)
    )
  }

  // Confirm no longer writes directly — it opens a reason prompt first.
  // Every office stock change must be attributable (see ReasonModal below).
  function openConfirm(productId: string) {
    const row = rows.find((r) => r.product.id === productId)
    if (!row || row.office_delta === 0) return
    setReasonModal({
      productId,
      delta: row.office_delta,
      newQty: Math.max(0, row.office_quantity + row.office_delta),
    })
    setReasonText('')
  }

  async function submitReason() {
    if (!reasonModal || !reasonText.trim()) return
    const { productId, delta } = reasonModal
    setReasonSaving(true)

    try {
      const res = await fetch('/api/warehouse-stock/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, delta, reason: reasonText.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? 'Failed to update office stock')
        return
      }
      toast.success('Office stock updated')
      setRows((prev) =>
        prev.map((r) =>
          r.product.id === productId
            ? { ...r, office_quantity: body.quantity_after, office_delta: 0 }
            : r
        )
      )
      setReasonModal(null)
      setReasonText('')
    } finally {
      setReasonSaving(false)
    }
  }

  async function openHistory(productId: string, productName: string) {
    setHistoryModal({ productId, productName })
    setHistoryItems(null)
    const res = await fetch(`/api/warehouse-stock/movements?product_id=${productId}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error('Failed to load history')
      setHistoryItems([])
      return
    }
    setHistoryItems(body.movements ?? [])
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Pairs Deployed', value: loading ? '—' : totalDeployed.toLocaleString(), color: 'bg-blue-500' },
          { label: 'Stores Low Stock', value: loading ? '—' : lowStockStores.toString(), color: 'bg-amber-500' },
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
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-72">Product</th>
                <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500 w-16">SKU</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 w-20">Stores</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 w-24">Deployed</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 w-36">Stores Low In Stock</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 w-32">Stock In Office</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 w-60">Edit Stock</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 w-10" />
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
                        <td className="px-4 py-3 cursor-pointer w-72" onClick={() => toggleExpand(row.product.id)}>
                          <p className="font-medium text-gray-900 truncate" title={row.product.name}>{row.product.name}</p>
                          <p className="text-[10px] text-gray-400">{PRODUCT_CATEGORY_LABELS[row.product.category]}</p>
                        </td>
                        <td className="px-2 py-3 text-center font-mono text-xs text-gray-500 cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.product.sku}
                        </td>
                        <td className="px-3 py-3 text-center cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.stores_stocking}
                        </td>
                        <td className="px-3 py-3 text-center font-semibold cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.total_deployed}
                        </td>
                        <td className="px-3 py-3 text-center cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          {row.low_stock_stores > 0 ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                              {row.low_stock_stores}
                            </span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        {/* Stock In Office — plain display of the total we currently have; never changes until Confirm */}
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="font-semibold text-gray-900 tabular-nums">{row.office_quantity}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openHistory(row.product.id, row.product.name) }}
                              title="View change history"
                              className="text-gray-300 hover:text-gray-600"
                            >
                              <History size={13} />
                            </button>
                          </div>
                        </td>

                        {/* Edit Stock — separate column, this is the only place adjustments happen */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col items-center gap-1.5">
                            <div className="inline-flex items-center border border-gray-200 rounded-lg overflow-hidden w-fit">
                              <button
                                type="button"
                                onClick={() => adjustOffice(row.product.id, -1)}
                                disabled={row.office_saving}
                                className="w-7 h-7 flex items-center justify-center text-gray-600 text-sm font-bold hover:bg-gray-100 disabled:opacity-40"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                value={row.office_delta}
                                onChange={(e) => setOfficeDelta(row.product.id, parseInt(e.target.value, 10) || 0)}
                                onWheel={(e) => e.currentTarget.blur()}
                                autoComplete="off"
                                disabled={row.office_saving}
                                className="w-14 h-7 text-center text-xs border-x border-gray-200 outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <button
                                type="button"
                                onClick={() => adjustOffice(row.product.id, 1)}
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
                                  onClick={() => openConfirm(row.product.id)}
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

                        <td className="px-3 py-3 text-center text-gray-400 cursor-pointer" onClick={() => toggleExpand(row.product.id)}>
                          <div className="flex justify-center">
                            {row.expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </div>
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

      {/* ── Reason Modal — every office stock change must be attributed ────────── */}
      {reasonModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => !reasonSaving && setReasonModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Confirm Stock Change</h3>
              <button onClick={() => !reasonSaving && setReasonModal(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>

            <div className="flex items-center justify-center gap-2 mb-4 bg-gray-50 rounded-lg py-3">
              <span className={cn('text-lg font-bold tabular-nums', reasonModal.delta > 0 ? 'text-green-600' : 'text-red-600')}>
                {reasonModal.delta > 0 ? `+${reasonModal.delta}` : reasonModal.delta}
              </span>
              <span className="text-sm text-gray-400">→</span>
              <span className="text-lg font-bold text-gray-900 tabular-nums">{reasonModal.newQty}</span>
            </div>

            <label className="text-xs font-medium text-gray-600 block mb-1.5">Reason (required)</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {['New stock arrived', 'Physical recount', 'Damaged / written off'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReasonText(preset)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  {preset}
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Why is office stock changing?"
              disabled={reasonSaving}
              autoFocus
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
            />

            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => setReasonModal(null)}
                disabled={reasonSaving}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitReason}
                disabled={reasonSaving || !reasonText.trim()}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {reasonSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── History Modal ───────────────────────────────────────────────────────── */}
      {historyModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setHistoryModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="text-base font-semibold text-gray-900">{historyModal.productName} — Stock History</h3>
              <button onClick={() => setHistoryModal(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {historyItems === null ? (
                <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
              ) : historyItems.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No changes recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {historyItems.map((m) => (
                    <div key={m.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn('text-sm font-bold tabular-nums', m.delta > 0 ? 'text-green-600' : 'text-red-600')}>
                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(m.created_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">{m.reason}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-gray-400">
                          {m.quantity_before} → {m.quantity_after}
                          {m.reference_type && m.reference_type !== 'manual' && (
                            <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 rounded-full">{m.reference_type.replace('_', ' ')}</span>
                          )}
                        </span>
                        <span className="text-[10px] text-gray-400">{m.created_by_profile?.full_name ?? 'Unknown'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
