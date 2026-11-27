'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Search, X, Package, CheckCircle2, AlertTriangle, Loader2, RefreshCcw, Upload, ArrowRightLeft, Plus, Minus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatMYDate } from '@/lib/utils'
import type { Product } from '@/types'
import { toast } from 'sonner'
import { TargetCalculator } from '@/components/events/target-calculator'
import { PartTimersSection } from '@/components/events/part-timers-section'
import { PosSalesSection } from '@/components/events/pos-sales-section'
import { StockListToggle, StockListPanel, type StockListLineIn } from '@/components/stock/StockListReader'
import { isExcludedFromPos } from '@/lib/pos/catalog'

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
  quantity_added: number        // added into the event location
  quantity_sold_pos: number     // units sold through the Event POS (not voided)
  quantity_sold_outside: number // sold outside the POS, deducted at close
  quantity_removed: number      // "Remove stock from event" corrections
  quantity_returned: number     // left over and cleared at close
  quantity_left: number         // in the event location right now
  // Closed events: the admin's typed Returned count vs expected (event_close_counts)
  close_count: { expected_left: number; returned: number; variance: number } | null
  product: { sku: string; name: string; image_url: string | null } | null
}

interface CheckoutDraftItem { product_id: string; quantity: number }
type MoveDirection = 'add' | 'remove'

interface ParsedLine { sku: string; quantity: number; product_id: string | null; product_name: string | null }

// Close modal "Bulk fill Returned" only. Add / Remove stock uses the shared
// stock list reader (components/stock/StockListReader.tsx).
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
  const [usesPos, setUsesPos] = useState(false)
  const [hasCloseCounts, setHasCloseCounts] = useState(false)
  const [salesKey, setSalesKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<Product[]>([])

  const [direction, setDirection] = useState<MoveDirection>('add')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<CheckoutDraftItem[]>([])
  const [checkingOut, setCheckingOut] = useState(false)
  // Stock list reader: what it read sits here as a preview until "Add to list".
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkRead, setBulkRead] = useState<StockListLineIn[]>([])

  const [closeModal, setCloseModal] = useState(false)
  const [closeRows, setCloseRows] = useState<Record<string, { sold: number; returned: number }>>({})
  const [fetchingShopify, setFetchingShopify] = useState(false)
  const [shopifyFetchError, setShopifyFetchError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeResult, setCloseResult] = useState<{ tallies: boolean; off: Array<{ product_id: string; variance: number }> } | null>(null)
  const [closeBulkOpen, setCloseBulkOpen] = useState(false)
  const [closeBulkText, setCloseBulkText] = useState('')

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/events/${eventId}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error ?? 'Failed to load event'); setLoading(false); return }
    setEvent(body.event)
    setItems(body.items ?? [])
    setUsesPos(!!body.uses_pos)
    setHasCloseCounts(!!body.has_close_counts)
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
    // checkout = add stock into the event; return = remove stock from the event.
    // Neither touches Office.
    const endpoint = direction === 'add' ? 'checkout' : 'return'
    try {
      const res = await fetch(`/api/events/${eventId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: draft }),
      })
      const body = await res.json().catch(() => ({}))
      const done = new Set<string>(Array.isArray(body.done) ? body.done : [])
      if (!res.ok || res.status === 207) {
        // Lines that went through are dropped so a retry never applies them twice.
        if (done.size > 0) { setDraft((prev) => prev.filter((d) => !done.has(d.product_id))); fetchDetail() }
        const details = Array.isArray(body.details) ? body.details.join(' · ') : ''
        toast.error(`${body.error ?? 'Failed'}${details ? ` — ${details}` : ''}`)
        return
      }
      toast.success(direction === 'add' ? 'Stock added to event' : 'Stock removed from event')
      setDraft([])
      setBulkRead([])
      setBulkOpen(false)
      fetchDetail()
    } finally {
      setCheckingOut(false)
    }
  }

  // Lines the reader read, checked for this direction. Remove: capped at what
  // is left in the event, less what is already on the list below.
  function previewLines() {
    return bulkRead.map((l) => {
      const p = products.find((pp) => pp.id === l.product_id)
      if (direction === 'add') return { ...l, product: p, use: l.quantity, room: null as number | null }
      const left = items.find((it) => it.product_id === l.product_id)?.quantity_left ?? 0
      const inDraft = draft.find((d) => d.product_id === l.product_id)?.quantity ?? 0
      const room = Math.max(0, left - inDraft)
      return { ...l, product: p, use: Math.min(l.quantity, room), room }
    })
  }

  function setBulkQty(productId: string, qty: number) {
    setBulkRead((prev) => prev.map((l) => l.product_id === productId ? { ...l, quantity: Math.max(0, qty) } : l))
  }

  function applyBulkPreview() {
    const lines = previewLines()
    if (lines.some((l) => l.quantity <= 0)) { toast.error('Enter the pairs on every line, or skip it'); return }
    const usable = lines.filter((l) => l.use > 0)
    if (usable.length === 0) { toast.error(direction === 'remove' ? 'None of these are left in this event' : 'Nothing to add'); return }
    setDraft((prev) => {
      const next = [...prev]
      for (const line of usable) {
        const idx = next.findIndex((i) => i.product_id === line.product_id)
        if (idx >= 0) next[idx] = { ...next[idx], quantity: next[idx].quantity + line.use }
        else next.push({ product_id: line.product_id, quantity: line.use })
      }
      return next
    })
    toast.success(`${usable.length} SKU${usable.length > 1 ? 's' : ''} added to the list below`)
    setBulkRead([])
    setBulkOpen(false)
  }

  function openCloseModal() {
    const initial: Record<string, { sold: number; returned: number }> = {}
    // Event POS used → its sales are the sold quantities (already out of event stock).
    for (const item of items) initial[item.product_id] = { sold: usesPos ? item.quantity_sold_pos ?? 0 : 0, returned: 0 }
    setCloseRows(initial)
    setCloseResult(null)
    setShopifyFetchError(null)
    setCloseModal(true)

    if (!usesPos && event?.shopify_location_id) {
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
      if (!res.ok) {
        const details = Array.isArray(body.details) ? body.details.join(' · ') : ''
        toast.error(`${body.error ?? 'Failed to close event'}${details ? ` — ${details}` : ''}`)
        return
      }
      const off = ((body.results ?? []) as Array<{ product_id: string; variance: number }>).filter((r) => r.variance !== 0)
      setCloseResult({ tallies: body.tallies, off })
      setCloseModal(false)
      toast.success(body.tallies ? 'Event closed — everything tallies!' : 'Event closed — some quantities don\'t tally, see details')
      fetchDetail()
    } finally {
      setClosing(false)
    }
  }

  // Bulk-fill the Returned column from a pasted/uploaded "SKU, Quantity" list.
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

  // Products that can go to events: the Special Patches Series is left out,
  // same rule as the Event POS (lib/pos/catalog.ts).
  const eventProducts = useMemo(() => products.filter((p) => !isExcludedFromPos(p.name ?? '')), [products])
  const eventProductIds = useMemo(() => new Set(eventProducts.map((p) => p.id)), [eventProducts])

  if (loading) return <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
  if (!event) return <div className="py-12 text-center text-gray-400 text-sm">Event not found</div>

  const isActive = event.status === 'active'
  // What should physically come back: what's left in event stock minus any
  // sold figure that close will still deduct (above POS, or all without POS).
  const expectedRemaining = (item: EventItem) => {
    const sold = closeRows[item.product_id]?.sold ?? 0
    const toDeduct = usesPos ? Math.max(0, sold - item.quantity_sold_pos) : sold
    return item.quantity_left - toDeduct
  }
  const skuOf = (pid: string) => items.find((i) => i.product_id === pid)?.product?.sku ?? pid

  return (
    <div className="space-y-6 max-w-4xl">
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
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {isActive && (
              <>
                <a href={`/pos/${event.id}`} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">Open POS</a>
                <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/pos/${event.id}`)
                    .then(() => toast.success('POS link copied — send it to the part-timers'))
                    .catch(() => toast.error('Copy failed'))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">Copy link</button>
              </>
            )}
            {isActive && items.length > 0 && (
              <button onClick={openCloseModal}
                className="px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors">
                Close Event
              </button>
            )}
          </div>
        </div>
      </div>

      <PosSalesSection eventId={event.id} eventName={event.name} isActive={isActive} refreshKey={salesKey} />
      <PartTimersSection eventId={event.id} isActive={isActive} />
      <TargetCalculator eventId={event.id} eventName={event.name} startDate={event.start_date} endDate={event.end_date}
        onSaved={() => setSalesKey((k) => k + 1)} />

      {/* Event stock — only while active. Add stock into the event, or remove
          it (corrections), by search or bulk paste/file import. Event stock
          is separate from Office: nothing is taken from or put back into it. */}
      {isActive && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Event Stock</h3>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
              <button type="button" onClick={() => setDirection('add')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors',
                  direction === 'add' ? 'bg-[#0A0A0A] text-white' : 'text-gray-500 hover:bg-gray-50')}>
                <Plus size={12} /> Add stock to event
              </button>
              <button type="button" onClick={() => setDirection('remove')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors border-l border-gray-200',
                  direction === 'remove' ? 'bg-[#0A0A0A] text-white' : 'text-gray-500 hover:bg-gray-50')}>
                <Minus size={12} /> Remove stock from event
              </button>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 mb-2">
            {direction === 'add'
              ? 'Adds pairs straight into this event\'s stock. Office stock is not touched or checked.'
              : 'For corrections and miscounts: takes pairs out of this event\'s stock only (never below 0, never into Office).'}
          </p>
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

          {/* Stock list reader — same one as Create / Edit DO. Reads any list
              (codes, colours, "SKU, Quantity", photos) into a preview here. */}
          <div className="mt-2 flex justify-end">
            <StockListToggle open={bulkOpen} onClick={() => { setBulkOpen((v) => !v); setBulkRead([]) }} />
          </div>

          {bulkOpen && (
            <div className="mt-2 space-y-2">
              <StockListPanel
                products={eventProducts}
                items={bulkRead}
                onApply={(next) => setBulkRead(next.filter((l) => eventProductIds.has(l.product_id)))}
                label={direction === 'add'
                  ? 'Paste the list of stock going to this event, or add a photo of it'
                  : 'Paste the list of stock to take out of this event, or add a photo of it'}
                placeholder={'A27 x6 / ankle black 6 / Teddy Brown = 4 / A1, 12 (one per line)'}
                aiScope="event"
                allowTextFile
              />

              {bulkRead.length > 0 && (() => {
                const lines = previewLines()
                const missingQty = lines.filter((l) => l.quantity <= 0).length
                const usable = lines.filter((l) => l.use > 0)
                return (
                  <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-1">
                    <p className="text-xs font-semibold text-gray-700">
                      Preview: {lines.length} SKU{lines.length === 1 ? '' : 's'}, {usable.reduce((s, l) => s + l.use, 0)} pairs to {direction === 'add' ? 'add' : 'remove'}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      Lines that could not be matched are listed in the note above. Fix them in the text and read again (untick &ldquo;Replace current items&rdquo; to keep these), add them with the search, or leave them out. Special Patches Series never matches here.
                    </p>
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      {lines.map((l) => {
                        const noQty = l.quantity <= 0
                        const none = direction === 'remove' && l.room === 0
                        const capped = direction === 'remove' && !none && !noQty && l.room !== null && l.quantity > l.room
                        return (
                          <div key={l.product_id} className={cn('flex items-center gap-2 text-xs px-2 py-1.5 rounded',
                            noQty || none ? 'bg-red-50' : capped ? 'bg-amber-50' : 'bg-gray-50')}>
                            <span className="font-mono text-gray-600 w-24 truncate shrink-0">{l.product?.sku}</span>
                            <span className="flex-1 min-w-0">
                              <span className="block truncate text-gray-700">{l.product?.name}</span>
                              {noQty && <span className="block text-[10px] text-red-600">No quantity read. Enter the pairs or skip.</span>}
                              {none && <span className="block text-[10px] text-red-600">None left in this event{l.quantity > 0 ? ' (or all already on the list below)' : ''}. Skipped.</span>}
                              {capped && <span className="block text-[10px] text-amber-700">Only {l.room} left in this event{draft.some((d) => d.product_id === l.product_id) ? ' after the list below' : ''}. {l.room} will be removed, not {l.quantity}.</span>}
                            </span>
                            <input type="number" min={0} value={l.quantity || ''} placeholder="pairs"
                              onChange={(e) => setBulkQty(l.product_id, Number(e.target.value) || 0)}
                              className={cn('w-16 h-7 text-center text-sm border rounded-lg focus:outline-none shrink-0',
                                noQty ? 'border-red-300 bg-white' : 'border-gray-200')} />
                            <button type="button" title="Skip this line"
                              onClick={() => setBulkRead((prev) => prev.filter((x) => x.product_id !== l.product_id))}
                              className="text-gray-400 hover:text-red-500 shrink-0"><X size={14} /></button>
                          </div>
                        )
                      })}
                    </div>
                    <button type="button" onClick={applyBulkPreview} disabled={missingQty > 0 || usable.length === 0}
                      className="w-full mt-1 py-2 bg-[#0A0A0A] text-[#FFD700] rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-40">
                      {missingQty > 0
                        ? `Enter pairs on ${missingQty} line${missingQty === 1 ? '' : 's'} (or skip) to continue`
                        : `Add ${usable.length} SKU${usable.length === 1 ? '' : 's'} to list`}
                    </button>
                  </div>
                )
              })()}
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
                  {direction === 'add' ? 'Add' : 'Remove'} {draft.reduce((s, i) => s + i.quantity, 0)} Pairs
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Per-SKU event stock — from the event location and ledger only */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">
            {isActive ? 'Event Stock' : 'Event Stock — Final'}
          </h3>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No stock added yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Product</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Added</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Sold (POS)</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Removed / Returned</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Left</th>
                {!isActive && hasCloseCounts && (
                  <>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500" title="What the admin counted back at close vs what should have been left">Counted back</th>
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
                  <td className="px-3 py-2.5 text-center tabular-nums">{item.quantity_added}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums">
                    {item.quantity_sold_pos}
                    {item.quantity_sold_outside > 0 && (
                      <span className="block text-[10px] text-gray-400">+{item.quantity_sold_outside} outside POS</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums">
                    {item.quantity_removed + item.quantity_returned}
                    {item.quantity_removed > 0 && item.quantity_returned > 0 && (
                      <span className="block text-[10px] text-gray-400">{item.quantity_removed} removed · {item.quantity_returned} at close</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-semibold tabular-nums">{item.quantity_left}</td>
                  {!isActive && hasCloseCounts && (
                    <>
                      <td className="px-3 py-2.5 text-center tabular-nums">
                        {item.close_count ? (
                          <>
                            {item.close_count.returned}
                            <span className="block text-[10px] text-gray-400">expected {item.close_count.expected_left}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {!item.close_count ? '—' : item.close_count.variance === 0 ? (
                          <span className="inline-flex items-center gap-1 text-green-600 text-xs font-semibold">
                            <CheckCircle2 size={12} /> Tallies
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600 text-xs font-semibold">
                            <AlertTriangle size={12} /> {item.close_count.variance > 0 ? `+${item.close_count.variance}` : item.close_count.variance}
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
                <p className="text-xs text-gray-500 mt-0.5">Confirm units sold and enter what physically came back. This is the record of the event — leftover event stock is cleared when you close.</p>
              </div>
              <button onClick={() => !closing && setCloseModal(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                Returned stock is not added to Office in XCMS — update Office stock in Shopify.
              </div>
              {usesPos && (
                <div className="text-xs text-green-800 bg-green-50 rounded-lg px-3 py-2 mb-3">
                  Sold = Event POS sales (voided sales excluded). They already left event stock — only raise a number for pairs sold outside the POS.
                </div>
              )}
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
                        <p className="text-[10px] text-gray-400 mt-0.5">Added: {item.quantity_added} · Left now: {item.quantity_left} · Expected back: {expectedRemaining(item)}</p>
                      </div>
                      <div className="text-center shrink-0">
                        <label className="text-[10px] text-gray-400 block mb-0.5">Sold</label>
                        <input type="number" min={usesPos ? item.quantity_sold_pos : 0} value={row.sold}
                          onChange={(e) => setCloseRows((prev) => ({ ...prev, [item.product_id]: { ...prev[item.product_id], sold: Math.max(usesPos ? item.quantity_sold_pos : 0, Number(e.target.value) || 0) } }))}
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
              <div className="text-sm text-red-800">
                <p className="font-medium">Some quantities don&apos;t tally (counted back − expected left), also shown in the table above:</p>
                <p className="text-xs mt-1">{closeResult.off.map((r) => `${skuOf(r.product_id)} ${r.variance > 0 ? `+${r.variance}` : r.variance}`).join(' · ')}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
