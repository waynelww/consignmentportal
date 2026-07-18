'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Search, X, Package, CheckCircle2, AlertTriangle, Loader2, RefreshCcw, Upload, ArrowRightLeft, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatMYDate } from '@/lib/utils'
import type { Product } from '@/types'
import { toast } from 'sonner'

interface EventDetail {
  id: string
  name: string
  location: string | null
  shopify_location_id: string | null
  shopify_location_name: string | null
  start_date: string
  end_date: string | null
  status: 'active' | 'closed'
  notes: string | null
}

interface EventItem {
  product_id: string
  quantity_taken: number
  quantity_sold_shopify: number | null
  quantity_returned: number | null
  variance: number | null
  product: { sku: string; name: string; image_url: string | null } | null
}

interface CheckoutDraftItem { product_id: string; quantity: number }
type MoveDirection = 'outbound' | 'inbound'

interface ParsedLine { sku: string; quantity: number; product_id: string | null; product_name: string | null }

// Accepts "SKU, Quantity" or "SKU<TAB>Quantity" per line — pasted straight
// from Excel/Sheets, or read from an uploaded .csv/.txt file. Skips blank
// lines and an optional header row.
function parseSkuQtyText(text: string, products: Product[]): ParsedLine[] {
  const bySku = new Map(products.map((p) => [p.sku.toUpperCase(), p]))
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: ParsedLine[] = []
  for (const line of lines) {
    const parts = line.split(/[,\t]+/).map((p) => p.trim()).filter(Boolean)
    if (parts.length < 2) continue
    const sku = parts[0]
    const qty = parseInt(parts[1], 10)
    if (!sku || Number.isNaN(qty) || qty <= 0) continue
    if (sku.toLowerCase() === 'sku' || /qty|quantity/i.test(parts[1])) continue // header row
    const match = bySku.get(sku.toUpperCase())
    out.push({ sku, quantity: qty, product_id: match?.id ?? null, product_name: match?.name ?? null })
  }
  return out
}

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [event, setEvent] = useState<EventDetail | null>(null)
  const [items, setItems] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<Product[]>([])

  const [direction, setDirection] = useState<MoveDirection>('outbound')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<CheckoutDraftItem[]>([])
  const [checkingOut, setCheckingOut] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkPreview, setBulkPreview] = useState<ParsedLine[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [closeModal, setCloseModal] = useState(false)
  const [closeRows, setCloseRows] = useState<Record<string, { sold: number; returned: number }>>({})
  const [fetchingShopify, setFetchingShopify] = useState(false)
  const [shopifyFetchError, setShopifyFetchError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeResult, setCloseResult] = useState<{ tallies: boolean } | null>(null)
  const [closeBulkOpen, setCloseBulkOpen] = useState(false)
  const [closeBulkText, setCloseBulkText] = useState('')

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/events/${eventId}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error ?? 'Failed to load event'); setLoading(false); return }
    setEvent(body.event)
    setItems(body.items ?? [])
    setLoading(false)
  }, [eventId])

  useEffect(() => {
    fetchDetail()
    supabase.from('products').select('id, sku, name, image_url').eq('is_active', true).order('sku')
      .then(({ data }) => setProducts((data ?? []) as unknown as Product[]))
  }, [fetchDetail])

  function addDraftItem(productId: string) {
    setDraft((prev) => {
      const ex = prev.find((i) => i.product_id === productId)
      return ex ? prev.map((i) => i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i)
                : [...prev, { product_id: productId, quantity: 1 }]
    })
    setSearch('')
  }
  function setDraftQty(productId: string, qty: number) {
    if (qty <= 0) { setDraft((prev) => prev.filter((i) => i.product_id !== productId)); return }
    setDraft((prev) => prev.map((i) => i.product_id === productId ? { ...i, quantity: qty } : i))
  }

  async function submitMove() {
    if (draft.length === 0) return
    setCheckingOut(true)
    const endpoint = direction === 'outbound' ? 'checkout' : 'return'
    try {
      const res = await fetch(`/api/events/${eventId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: draft }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Failed'); return }
      toast.success(direction === 'outbound' ? 'Stock checked out to event' : 'Stock returned to office')
      setDraft([])
      setBulkText('')
      setBulkPreview(null)
      setBulkOpen(false)
      fetchDetail()
    } finally {
      setCheckingOut(false)
    }
  }

  function parseBulk() {
    const parsed = parseSkuQtyText(bulkText, products)
    setBulkPreview(parsed)
  }

  function applyBulkPreview() {
    if (!bulkPreview) return
    const matched = bulkPreview.filter((l) => l.product_id)
    if (matched.length === 0) { toast.error('No matching SKUs found'); return }
    setDraft((prev) => {
      const next = [...prev]
      for (const line of matched) {
        const idx = next.findIndex((i) => i.product_id === line.product_id)
        if (idx >= 0) next[idx] = { ...next[idx], quantity: next[idx].quantity + line.quantity }
        else next.push({ product_id: line.product_id!, quantity: line.quantity })
      }
      return next
    })
    toast.success(`${matched.length} SKU${matched.length > 1 ? 's' : ''} added to the list below`)
    setBulkText('')
    setBulkPreview(null)
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setBulkText(String(reader.result ?? ''))
      setBulkPreview(null)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function openCloseModal() {
    const initial: Record<string, { sold: number; returned: number }> = {}
    for (const item of items) initial[item.product_id] = { sold: 0, returned: 0 }
    setCloseRows(initial)
    setCloseResult(null)
    setShopifyFetchError(null)
    setCloseModal(true)

    if (event?.shopify_location_id) {
      setFetchingShopify(true)
      fetch(`/api/events/${eventId}/shopify-sold`)
        .then((r) => r.json())
        .then((body) => {
          if (body.sold_by_product) {
            setCloseRows((prev) => {
              const next = { ...prev }
              for (const [pid, qty] of Object.entries(body.sold_by_product as Record<string, number>)) {
                next[pid] = { ...next[pid], sold: qty }
              }
              return next
            })
          } else {
            setShopifyFetchError(body.error ?? 'Could not fetch Shopify sales — enter sold quantities manually')
          }
        })
        .catch(() => setShopifyFetchError('Could not reach Shopify — enter sold quantities manually'))
        .finally(() => setFetchingShopify(false))
    }
  }

  async function submitClose() {
    setClosing(true)
    try {
      const payload = items.map((item) => ({
        product_id: item.product_id,
        quantity_sold: closeRows[item.product_id]?.sold ?? 0,
        quantity_returned: closeRows[item.product_id]?.returned ?? 0,
      }))
      const res = await fetch(`/api/events/${eventId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Failed to close event'); return }
      setCloseResult({ tallies: body.tallies })
      toast.success(body.tallies ? 'Event closed — everything tallies!' : 'Event closed — some quantities don\'t tally, see details')
      fetchDetail()
    } finally {
      setClosing(false)
    }
  }

  // Bulk-fill the Returned column from a pasted/uploaded "SKU, Quantity"
  // list — same import format as the outbound/inbound panel above.
  function applyCloseBulk() {
    const parsed = parseSkuQtyText(closeBulkText, products)
    const matched = parsed.filter((l) => l.product_id && items.some((it) => it.product_id === l.product_id))
    if (matched.length === 0) { toast.error('No matching SKUs found among items in this event'); return }
    setCloseRows((prev) => {
      const next = { ...prev }
      for (const line of matched) {
        next[line.product_id!] = { ...next[line.product_id!], returned: line.quantity }
      }
      return next
    })
    toast.success(`Filled Returned for ${matched.length} SKU${matched.length > 1 ? 's' : ''}`)
    setCloseBulkText('')
    setCloseBulkOpen(false)
  }

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 15)
  }, [search, products])

  if (loading) return <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
  if (!event) return <div className="py-12 text-center text-gray-400 text-sm">Event not found</div>

  const isActive = event.status === 'active'
  const expectedRemaining = (item: EventItem) => item.quantity_taken - (closeRows[item.product_id]?.sold ?? 0)

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/admin/events" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft size={14} /> Back to Events
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{event.name}</h2>
              <span className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
              )}>
                {event.status}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {formatMYDate(event.start_date)}{event.end_date ? ` – ${formatMYDate(event.end_date)}` : ''}
              {event.location && ` · ${event.location}`}
              {event.shopify_location_name && ` · Shopify: ${event.shopify_location_name}`}
            </p>
            {event.notes && <p className="text-xs text-gray-500 mt-2 italic">{event.notes}</p>}
          </div>
          {isActive && items.length > 0 && (
            <button onClick={openCloseModal}
              className="px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors shrink-0">
              Close Event
            </button>
          )}
        </div>
      </div>

      {/* Move Stock — only while active. Direct outbound (to event) or
          inbound (partial return), by search or bulk paste/file import. */}
      {isActive && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Move Stock</h3>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
              <button type="button" onClick={() => setDirection('outbound')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors',
                  direction === 'outbound' ? 'bg-[#0A0A0A] text-white' : 'text-gray-500 hover:bg-gray-50')}>
                <ArrowUpRight size={12} /> Outbound (to event)
              </button>
              <button type="button" onClick={() => setDirection('inbound')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors border-l border-gray-200',
                  direction === 'inbound' ? 'bg-[#0A0A0A] text-white' : 'text-gray-500 hover:bg-gray-50')}>
                <ArrowDownLeft size={12} /> Inbound (partial return)
              </button>
            </div>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by SKU or name…"
              className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
          </div>
          {searchMatches.length > 0 && (
            <div className="mt-1 border border-gray-200 rounded-lg max-h-48 overflow-y-auto bg-white shadow-sm">
              {searchMatches.map((p) => (
                <button key={p.id} type="button" onClick={() => addDraftItem(p.id)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-gray-500 shrink-0 w-24 truncate">{p.sku}</span>
                  <span className="text-gray-800 truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Bulk import — paste from Excel/Sheets or upload a .csv/.txt */}
          <button type="button" onClick={() => setBulkOpen((v) => !v)}
            className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1">
            <Upload size={12} /> {bulkOpen ? 'Hide bulk import' : 'Bulk import from file / paste a list'}
          </button>

          {bulkOpen && (
            <div className="mt-2 border border-gray-200 rounded-lg p-3 bg-gray-50/50">
              <p className="text-[11px] text-gray-500 mb-2">One SKU per line: <code className="bg-white px-1 rounded border border-gray-200">SKU, Quantity</code> — paste straight from a spreadsheet, or upload a file.</p>
              <div className="flex items-center gap-2 mb-2">
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 flex items-center gap-1.5">
                  <Upload size={12} /> Upload CSV / TXT
                </button>
                <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
              </div>
              <textarea
                rows={4}
                value={bulkText}
                onChange={(e) => { setBulkText(e.target.value); setBulkPreview(null) }}
                placeholder={'A1, 12\nA27, 6\nMAROONHORNBILL, 3'}
                className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
              />
              <button type="button" onClick={parseBulk} disabled={!bulkText.trim()}
                className="mt-2 text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-40">
                Preview
              </button>

              {bulkPreview && (
                <div className="mt-2 space-y-1">
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {bulkPreview.map((line, i) => (
                      <div key={i} className={cn('flex items-center justify-between text-xs px-2 py-1 rounded',
                        line.product_id ? 'bg-white' : 'bg-red-50')}>
                        <span className="font-mono text-gray-600">{line.sku}</span>
                        <span className={cn('truncate flex-1 mx-2', line.product_id ? 'text-gray-700' : 'text-red-600')}>
                          {line.product_name ?? 'Not found in product list'}
                        </span>
                        <span className="font-semibold text-gray-800 shrink-0">×{line.quantity}</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={applyBulkPreview}
                    className="w-full mt-1 py-2 bg-[#0A0A0A] text-[#FFD700] rounded-lg text-xs font-semibold hover:opacity-90">
                    Add {bulkPreview.filter((l) => l.product_id).length} Matched SKU{bulkPreview.filter((l) => l.product_id).length === 1 ? '' : 's'} to List
                  </button>
                </div>
              )}
            </div>
          )}

          {draft.length > 0 && (
            <div className="mt-3 border border-gray-100 rounded-lg overflow-hidden">
              {draft.map((d) => {
                const p = products.find((pp) => pp.id === d.product_id)
                return (
                  <div key={d.product_id} className="flex items-center gap-3 px-3 py-2 border-b border-gray-50 last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-gray-500">{p?.sku}</p>
                      <p className="text-sm text-gray-800 truncate">{p?.name}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setDraftQty(d.product_id, d.quantity - 1)} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200">−</button>
                      <input type="number" min={1} value={d.quantity} onChange={(e) => setDraftQty(d.product_id, Number(e.target.value) || 1)}
                        className="w-14 h-7 text-center text-sm border border-gray-200 rounded-lg focus:outline-none" />
                      <button onClick={() => setDraftQty(d.product_id, d.quantity + 1)} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200">+</button>
                      <button onClick={() => setDraftQty(d.product_id, 0)} className="ml-1 text-gray-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {draft.length > 0 && (
            <button onClick={submitMove} disabled={checkingOut}
              className="w-full mt-3 py-2.5 bg-[#0A0A0A] text-[#FFD700] rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2">
              {checkingOut ? (
                <>Processing…</>
              ) : (
                <>
                  <ArrowRightLeft size={14} />
                  {direction === 'outbound' ? 'Check Out' : 'Return'} {draft.reduce((s, i) => s + i.quantity, 0)} Pairs
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Taken / return summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">
            {isActive ? 'Currently Taken' : 'Final Reconciliation'}
          </h3>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Nothing checked out yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Product</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Taken</th>
                {!isActive && (
                  <>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Sold</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Returned</th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Variance</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.product_id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {item.product?.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.product.image_url} alt="" className="w-8 h-8 rounded-md object-cover bg-gray-50 border border-gray-100" />
                      ) : (
                        <div className="w-8 h-8 rounded-md bg-gray-50 border border-gray-100 flex items-center justify-center">
                          <Package size={12} className="text-gray-300" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-gray-400">{item.product?.sku}</p>
                        <p className="text-sm text-gray-800 truncate">{item.product?.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center font-semibold">{item.quantity_taken}</td>
                  {!isActive && (
                    <>
                      <td className="px-3 py-2.5 text-center">{item.quantity_sold_shopify ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center">{item.quantity_returned ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {item.variance === null ? '—' : item.variance === 0 ? (
                          <span className="inline-flex items-center gap-1 text-green-600 text-xs font-semibold">
                            <CheckCircle2 size={12} /> Tallies
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600 text-xs font-semibold">
                            <AlertTriangle size={12} /> {item.variance > 0 ? `+${item.variance}` : item.variance}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Close Event modal */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Close Event — Review &amp; Tally</h3>
                <p className="text-xs text-gray-500 mt-0.5">Confirm units sold and enter what physically came back.</p>
              </div>
              <button onClick={() => !closing && setCloseModal(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {fetchingShopify && (
                <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 mb-3">
                  <Loader2 size={12} className="animate-spin" /> Fetching Shopify sales for this event…
                </div>
              )}
              {shopifyFetchError && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                  <AlertTriangle size={12} /> {shopifyFetchError}
                </div>
              )}

              <button type="button" onClick={() => setCloseBulkOpen((v) => !v)}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 mb-2">
                <Upload size={12} /> {closeBulkOpen ? 'Hide bulk fill' : 'Bulk fill Returned from file / paste a list'}
              </button>
              {closeBulkOpen && (
                <div className="mb-3 border border-gray-200 rounded-lg p-3 bg-gray-50/50">
                  <p className="text-[11px] text-gray-500 mb-2">One SKU per line: <code className="bg-white px-1 rounded border border-gray-200">SKU, Quantity Returned</code></p>
                  <textarea
                    rows={3}
                    value={closeBulkText}
                    onChange={(e) => setCloseBulkText(e.target.value)}
                    placeholder={'A1, 4\nA27, 2'}
                    className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                  />
                  <button type="button" onClick={applyCloseBulk} disabled={!closeBulkText.trim()}
                    className="mt-2 text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-40">
                    Fill Returned Column
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {items.map((item) => {
                  const row = closeRows[item.product_id] ?? { sold: 0, returned: 0 }
                  return (
                    <div key={item.product_id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-gray-400">{item.product?.sku}</p>
                        <p className="text-sm text-gray-800 truncate">{item.product?.name}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Taken: {item.quantity_taken} · Expected back: {item.quantity_taken - row.sold}</p>
                      </div>
                      <div className="text-center shrink-0">
                        <label className="text-[10px] text-gray-400 block mb-0.5">Sold</label>
                        <input type="number" min={0} value={row.sold}
                          onChange={(e) => setCloseRows((prev) => ({ ...prev, [item.product_id]: { ...prev[item.product_id], sold: Math.max(0, Number(e.target.value) || 0) } }))}
                          className="w-16 h-8 text-center text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                      </div>
                      <div className="text-center shrink-0">
                        <label className="text-[10px] text-gray-400 block mb-0.5">Returned</label>
                        <input type="number" min={0} value={row.returned}
                          onChange={(e) => setCloseRows((prev) => ({ ...prev, [item.product_id]: { ...prev[item.product_id], returned: Math.max(0, Number(e.target.value) || 0) } }))}
                          className="w-16 h-8 text-center text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                      </div>
                      <div className="text-center shrink-0 w-16">
                        <label className="text-[10px] text-gray-400 block mb-0.5">Variance</label>
                        {(() => {
                          const v = row.returned - expectedRemaining(item)
                          return (
                            <span className={cn('text-sm font-bold tabular-nums', v === 0 ? 'text-green-600' : 'text-red-600')}>
                              {v > 0 ? `+${v}` : v}
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex gap-3 shrink-0">
              <button onClick={openCloseModal} disabled={closing || fetchingShopify}
                className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5">
                <RefreshCcw size={13} /> Refetch
              </button>
              <button onClick={() => setCloseModal(false)} disabled={closing}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitClose} disabled={closing}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50">
                {closing ? 'Closing…' : 'Confirm &amp; Close Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {closeResult && (
        <div className={cn(
          'rounded-xl p-4 flex items-center gap-3',
          closeResult.tallies ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        )}>
          {closeResult.tallies ? (
            <>
              <CheckCircle2 size={20} className="text-green-600 shrink-0" />
              <p className="text-sm text-green-800 font-medium">Everything tallies — all stock accounted for.</p>
            </>
          ) : (
            <>
              <AlertTriangle size={20} className="text-red-600 shrink-0" />
              <p className="text-sm text-red-800 font-medium">Some quantities don't tally — see the Variance column above.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
