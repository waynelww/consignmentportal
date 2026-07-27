'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Check, RotateCcw, Loader2, History, X, MapPin, Search } from 'lucide-react'
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
}

interface StockLocation { id: string; name: string; type: string }

interface StockTransfer {
  id: string
  quantity: number
  from_location: { name: string; type: string } | null
  to_location: { name: string; type: string } | null
  reason: string
  created_at: string
  created_by_profile: { full_name: string } | null
}

interface OtherLocationRow {
  location_name: string
  product_sku: string
  product_name: string
  quantity: number
}

const EXTERNAL_IN = '__external_in__'  // new stock arriving from outside the tracked system
const EXTERNAL_OUT = '__external_out__' // stock leaving the tracked system (written off, sample, etc.)

export default function StockPage() {
  const [rows, setRows] = useState<ProductStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [totalDeployed, setTotalDeployed] = useState(0)
  const [lowStockStores, setLowStockStores] = useState(0)
  const [totalSKUs, setTotalSKUs] = useState(0)
  const [officeLocationId, setOfficeLocationId] = useState<string | null>(null)
  const [otherLocations, setOtherLocations] = useState<OtherLocationRow[]>([])
  const [search, setSearch] = useState('')

  const [transferModal, setTransferModal] = useState<{ productId: string; delta: number; newQty: number } | null>(null)
  const [pickerLocations, setPickerLocations] = useState<StockLocation[]>([])
  const [loadingPicker, setLoadingPicker] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [transferSaving, setTransferSaving] = useState(false)

  const [historyModal, setHistoryModal] = useState<{ productId: string; productName: string } | null>(null)
  const [historyItems, setHistoryItems] = useState<StockTransfer[] | null>(null)

  const supabase = createClient()

  const fetchData = useCallback(async () => {
    setLoading(true)

    const [{ data: productsData }, { data: invData }, { data: locations }] = await Promise.all([
      supabase.from('products').select('*').eq('is_active', true).order('sku'),
      supabase.from('store_inventory').select('*, store:stores(id, store_name, city)'),
      supabase.from('stock_locations').select('id, name, type').eq('is_active', true),
    ])

    const products = (productsData || []) as Product[]
    const locationRows = (locations || []) as StockLocation[]
    const office = locationRows.find((l) => l.type === 'office')
    setOfficeLocationId(office?.id ?? null)

    let officeQtyMap: Record<string, number> = {}
    if (office) {
      const { data: officeStock } = await supabase
        .from('location_stock')
        .select('product_id, quantity')
        .eq('location_id', office.id)
      officeQtyMap = Object.fromEntries((officeStock ?? []).map((r: { product_id: string; quantity: number }) => [r.product_id, r.quantity]))
    }

    // Non-office locations with stock — Central Market, IOI, Custom Printing, active events
    const nonOfficeIds = locationRows.filter((l) => l.type !== 'office').map((l) => l.id)
    if (nonOfficeIds.length > 0) {
      const { data: otherStock } = await supabase
        .from('location_stock')
        .select('quantity, location:location_id(name), product:product_id(sku, name)')
        .in('location_id', nonOfficeIds)
        .gt('quantity', 0)
      setOtherLocations(
        ((otherStock ?? []) as unknown as Array<{ quantity: number; location: { name: string } | null; product: { sku: string; name: string } | null }>)
          .map((r) => ({
            location_name: r.location?.name ?? '—',
            product_sku: r.product?.sku ?? '—',
            product_name: r.product?.name ?? '—',
            quantity: r.quantity,
          }))
      )
    } else {
      setOtherLocations([])
    }

    type InvRow = {
      product_id: string
      quantity_on_hand: number
      restock_threshold: number
      store: { id: string; store_name: string; city: string } | null
    }
    const inventory = (invData || []) as InvRow[]

    const productMap: Record<string, ProductStockRow> = {}
    for (const p of products) {
      productMap[p.id] = {
        product: p,
        total_deployed: 0,
        stores_stocking: 0,
        low_stock_stores: 0,
        store_breakdown: [],
        expanded: false,
        office_quantity: officeQtyMap[p.id] || 0,
        office_delta: 0,
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
    setRows((prev) => prev.map((r) => r.product.id === productId ? { ...r, expanded: !r.expanded } : r))
  }

  const MAX_DELTA = 9999
  const clampDelta = (n: number) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, n))

  function adjustOffice(productId: string, delta: number) {
    setRows((prev) => prev.map((r) => r.product.id === productId ? { ...r, office_delta: clampDelta(r.office_delta + delta) } : r))
  }
  function setOfficeDelta(productId: string, delta: number) {
    setRows((prev) => prev.map((r) => r.product.id === productId ? { ...r, office_delta: clampDelta(delta) } : r))
  }
  function resetOfficeDelta(productId: string) {
    setRows((prev) => prev.map((r) => r.product.id === productId ? { ...r, office_delta: 0 } : r))
  }

  // Confirm opens the transfer modal — every office stock change must say
  // where the stock is coming from or going to, not just a free-text reason.
  function openConfirm(productId: string) {
    const row = rows.find((r) => r.product.id === productId)
    if (!row || row.office_delta === 0) return
    setTransferModal({ productId, delta: row.office_delta, newQty: Math.max(0, row.office_quantity + row.office_delta) })
    setSelectedLocation('')
    setTransferNote('')
    setLoadingPicker(true)
    fetch('/api/inventory/locations')
      .then((r) => r.json())
      .then((body) => setPickerLocations((body.locations ?? []).filter((l: StockLocation) => l.type !== 'office')))
      .catch(() => toast.error('Could not load locations'))
      .finally(() => setLoadingPicker(false))
  }

  async function submitTransfer() {
    if (!transferModal || !officeLocationId || !selectedLocation) return
    const { productId, delta } = transferModal
    const quantity = Math.abs(delta)
    const inbound = delta > 0

    const otherIsExternal = selectedLocation === EXTERNAL_IN || selectedLocation === EXTERNAL_OUT
    const fromLocationId = inbound ? (otherIsExternal ? null : selectedLocation) : officeLocationId
    const toLocationId = inbound ? officeLocationId : (otherIsExternal ? null : selectedLocation)

    setTransferSaving(true)
    try {
      const res = await fetch('/api/inventory/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          quantity,
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          reason: transferNote.trim(),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Transfer failed'); return }
      toast.success('Stock transferred')
      setRows((prev) => prev.map((r) => r.product.id === productId ? { ...r, office_quantity: transferModal.newQty, office_delta: 0 } : r))
      setTransferModal(null)
      fetchData() // refresh "Other Locations" too
    } finally {
      setTransferSaving(false)
    }
  }

  async function openHistory(productId: string, productName: string) {
    setHistoryModal({ productId, productName })
    setHistoryItems(null)
    const res = await fetch(`/api/inventory/transfers?product_id=${productId}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error('Failed to load history'); setHistoryItems([]); return }
    setHistoryItems(body.transfers ?? [])
  }

  const pickerLabel = transferModal && transferModal.delta > 0 ? 'Where is this coming from?' : 'Where is this going?'

  const otherLocationsByLocation = useMemo(() => {
    const map: Record<string, OtherLocationRow[]> = {}
    for (const row of otherLocations) {
      if (!map[row.location_name]) map[row.location_name] = []
      map[row.location_name].push(row)
    }
    return map
  }, [otherLocations])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.product.name.toLowerCase().includes(q) || r.product.sku.toLowerCase().includes(q))
  }, [rows, search])

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
          <p className="text-xs text-gray-500 mt-0.5 mb-3">Click a row to see the per-store breakdown. Adjust office stock with +/− then confirm — every change records where the stock went.</p>
          <div className="relative max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or SKU…"
              className="w-full h-9 pl-9 pr-8 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
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
                : filteredRows.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">No SKUs match &quot;{search}&quot;</td></tr>
                  )
                : filteredRows.map((row) => (
                    <>
                      <tr
                        key={row.product.id}
                        className={cn('border-b border-gray-50 hover:bg-gray-50/50', row.expanded && 'bg-gray-50')}
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

                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col items-center gap-1.5">
                            <div className="inline-flex items-center border border-gray-200 rounded-lg overflow-hidden w-fit">
                              <button type="button" onClick={() => adjustOffice(row.product.id, -1)}
                                className="w-7 h-7 flex items-center justify-center text-gray-600 text-sm font-bold hover:bg-gray-100">
                                −
                              </button>
                              <input
                                type="number"
                                value={row.office_delta}
                                onChange={(e) => setOfficeDelta(row.product.id, parseInt(e.target.value, 10) || 0)}
                                onWheel={(e) => e.currentTarget.blur()}
                                autoComplete="off"
                                className="w-14 h-7 text-center text-xs border-x border-gray-200 outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <button type="button" onClick={() => adjustOffice(row.product.id, 1)}
                                className="w-7 h-7 flex items-center justify-center text-gray-600 text-sm font-bold hover:bg-gray-100">
                                +
                              </button>
                            </div>
                            {row.office_delta !== 0 && (
                              <div className="flex items-center gap-1.5">
                                <span className={cn('text-[11px] font-semibold tabular-nums', row.office_delta > 0 ? 'text-green-600' : 'text-red-600')}>
                                  → {Math.max(0, row.office_quantity + row.office_delta)}
                                </span>
                                <button type="button" onClick={() => openConfirm(row.product.id)} title="Confirm"
                                  className="w-6 h-6 rounded-md bg-green-600 text-white flex items-center justify-center hover:bg-green-700 shrink-0">
                                  <Check size={12} />
                                </button>
                                <button type="button" onClick={() => resetOfficeDelta(row.product.id)} title="Reset"
                                  className="w-6 h-6 rounded-md bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 shrink-0">
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
                                        <Link href={`/admin/stores/${sb.store_id}?tab=overview`} className="text-blue-700 hover:underline font-medium">
                                          {sb.store_name}
                                        </Link>
                                      </td>
                                      <td className="py-1.5 px-3 text-gray-500">{sb.city}</td>
                                      <td className={cn('py-1.5 px-3 text-right font-medium', sb.quantity_on_hand <= sb.threshold ? 'text-amber-600' : 'text-gray-800')}>
                                        {sb.quantity_on_hand}
                                      </td>
                                      <td className="py-1.5 px-3 text-right text-gray-500">{sb.threshold}</td>
                                    </tr>
                                  ))}
                                  {row.store_breakdown.length === 0 && (
                                    <tr><td colSpan={4} className="py-3 text-center text-gray-400">No stores stocking this product</td></tr>
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

      {/* Other Locations — Central Market, IOI, Custom Printing, active events */}
      {Object.keys(otherLocationsByLocation).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <MapPin size={14} className="text-gray-400" /> Stock at Other Locations
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Balances as recorded by transfers — not live Shopify counts.</p>
          </div>
          <div className="divide-y divide-gray-50">
            {Object.entries(otherLocationsByLocation).map(([locName, items]) => (
              <div key={locName} className="px-5 py-3">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">{locName}</p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((it) => (
                    <span key={it.product_sku} className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 text-xs">
                      <span className="font-mono text-gray-500">{it.product_sku}</span>
                      <span className="font-bold text-gray-800">×{it.quantity}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Transfer Modal ───────────────────────────────────────────────────── */}
      {transferModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => !transferSaving && setTransferModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Confirm Stock Transfer</h3>
              <button onClick={() => !transferSaving && setTransferModal(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>

            <div className="flex items-center justify-center gap-2 mb-4 bg-gray-50 rounded-lg py-3">
              <span className={cn('text-lg font-bold tabular-nums', transferModal.delta > 0 ? 'text-green-600' : 'text-red-600')}>
                {transferModal.delta > 0 ? `+${transferModal.delta}` : transferModal.delta}
              </span>
              <span className="text-sm text-gray-400">→</span>
              <span className="text-lg font-bold text-gray-900 tabular-nums">{transferModal.newQty}</span>
            </div>

            <label className="text-xs font-medium text-gray-600 block mb-1.5">{pickerLabel}</label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              disabled={loadingPicker || transferSaving}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] disabled:opacity-50 mb-3"
            >
              <option value="">{loadingPicker ? 'Loading…' : 'Select…'}</option>
              {transferModal.delta > 0 ? (
                <>
                  <option value={EXTERNAL_IN}>New stock (factory / vendor)</option>
                  {pickerLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </>
              ) : (
                <>
                  {pickerLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  <option value={EXTERNAL_OUT}>Written off / damaged / sample</option>
                </>
              )}
            </select>

            <label className="text-xs font-medium text-gray-600 block mb-1.5">Note (optional)</label>
            <textarea
              rows={2}
              value={transferNote}
              onChange={(e) => setTransferNote(e.target.value)}
              placeholder="Any extra detail…"
              disabled={transferSaving}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
            />

            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setTransferModal(null)} disabled={transferSaving}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={submitTransfer} disabled={transferSaving || !selectedLocation}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2">
                {transferSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
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
              <h3 className="text-base font-semibold text-gray-900">{historyModal.productName} — Transfer History</h3>
              <button onClick={() => setHistoryModal(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {historyItems === null ? (
                <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
              ) : historyItems.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No transfers recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {historyItems.map((t) => (
                    <div key={t.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-gray-900 tabular-nums">×{t.quantity}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(t.created_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-gray-700 font-medium">
                        {t.from_location?.name ?? 'External'} → {t.to_location?.name ?? 'External'}
                      </p>
                      {t.reason && <p className="text-xs text-gray-500 mt-0.5">{t.reason}</p>}
                      <p className="text-[10px] text-gray-400 mt-1.5 text-right">{t.created_by_profile?.full_name ?? 'Unknown'}</p>
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
