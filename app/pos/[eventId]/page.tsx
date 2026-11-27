'use client'

// Xocks Event POS — phone only, no XCMS login. Part-timer taps their tile,
// enters a 4-digit PIN, then sells from THIS event's XCMS stock location.
// Everything goes through /api/pos/[eventId]/*; prices, discount and stock
// are re-checked on the server for every sale. Part-timers never see event
// profit or bonus unlock status (the API doesn't return them).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Search, ScanLine, X, Minus, Plus, Delete, ChevronLeft, Check, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import BarcodeScanner, { primeScannerAudio } from '@/components/scanner/BarcodeScanner'
import { findByBarcode } from '@/lib/barcode/normalize'
import { POS_CHIPS, chipMatches, remainingFor, type PosChip, type PosProduct } from '@/lib/pos/catalog'
import { cartTotals, evaluateDiscount, type DiscountLine, type PosDiscount } from '@/lib/pos/discounts'

type Staff = { id: string; name: string }
type Phase = 'loading' | 'notfound' | 'closed' | 'who' | 'pin' | 'sell'
type Pay = 'cash' | 'card' | 'qr'

interface ShiftData {
  sales_count: number; pairs: number; total: number; discounts: number
  split: { cash: number; card: number; qr: number }
  bonus: null | {
    day_label: string; progress: number; earned: number; tier_hit: number
    tiers: { tier: number; mark: number; bonus: number; hit: boolean }[]
    next: { tier: number; more: number } | null
  }
}
interface MySale {
  id: string; sale_no: number; event_day: string; payment_method: Pay; subtotal: number; discount_label: string | null
  discount_amount: number; total: number; voided: boolean; created_at: string
  items: { name: string; sku: string; qty: number; unit_price: number; is_pair: boolean }[]
}
interface MySalesData { today: string; day: string; days: string[]; totals: { count: number; pairs: number; total: number; discounts: number }; sales: MySale[] }

const rm = (n: number) => `RM${n.toFixed(2)}`
const PAY_LABEL: Record<Pay, string> = { cash: 'Cash', card: 'Card', qr: 'QR' }
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const timeMY = (iso: string) => new Date(iso).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit' })
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

/** "Plain Series - Ankle - Black" → title "Ankle - Black", series "Plain Series". */
function splitName(name: string) {
  const parts = name.split(' - ')
  return parts.length > 1 ? { title: parts.slice(1).join(' - '), series: parts[0] } : { title: name, series: '' }
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T & { error?: string } }> {
  try {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store' })
    const body = await res.json().catch(() => ({ error: `Server error (${res.status}) — try again` }))
    return { ok: res.ok, status: res.status, body }
  } catch {
    return { ok: false, status: 0, body: { error: 'No connection — check the internet and try again' } as T & { error: string } }
  }
}

export default function EventPosPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const base = `/api/pos/${eventId}`

  const [phase, setPhase] = useState<Phase>('loading')
  const [eventName, setEventName] = useState('')
  const [staff, setStaff] = useState<Staff[]>([])
  const [me, setMe] = useState<Staff | null>(null)
  const [picked, setPicked] = useState<Staff | null>(null)

  const [products, setProducts] = useState<PosProduct[]>([])
  const [discounts, setDiscounts] = useState<PosDiscount[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [cartOrder, setCartOrder] = useState<string[]>([])
  const [discountId, setDiscountId] = useState<string | null>(null)
  const [droppedNote, setDroppedNote] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<PosChip>('all')
  const [view, setView] = useState<'grid' | 'cart' | 'sales' | 'shift'>('grid')
  const [discountPicker, setDiscountPicker] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [scanning, setScanning] = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────
  const loadState = useCallback(async () => {
    const r = await api<{ closed?: boolean; event?: { name: string }; staff?: Staff[]; me?: Staff | null }>(`${base}/state`)
    if (r.status === 404) { setPhase('notfound'); return }
    if (!r.ok) { setPhase('notfound'); toast.error(r.body.error ?? 'Could not load'); return }
    setEventName(r.body.event?.name ?? '')
    if (r.body.closed) { setPhase('closed'); return }
    setStaff(r.body.staff ?? [])
    if (r.body.me) { setMe(r.body.me); setPhase('sell') } else setPhase('who')
  }, [base])

  const loadCatalog = useCallback(async () => {
    const r = await api<{ products: PosProduct[]; discounts: PosDiscount[] }>(`${base}/catalog`)
    if (r.status === 401) { setMe(null); loadState(); return }
    if (!r.ok) { toast.error(r.body.error ?? 'Could not load products'); return }
    setProducts(r.body.products); setDiscounts(r.body.discounts)
  }, [base, loadState])

  useEffect(() => { loadState() }, [loadState])
  useEffect(() => { if (phase === 'sell') loadCatalog() }, [phase, loadCatalog])
  useEffect(() => {
    if (phase !== 'sell') return
    const onFocus = () => { if (document.visibilityState === 'visible') loadCatalog() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [phase, loadCatalog])

  // ── Cart maths (same rules as the server) ─────────────────────────────
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const lines: DiscountLine[] = useMemo(() => cartOrder.flatMap((id) => {
    const p = byId.get(id); const qty = cart[id] ?? 0
    return p && qty > 0 ? [{ unit_price: p.price, qty, is_pair: p.is_pair, is_patch: p.is_patch, design: p.design }] : []
  }), [cartOrder, cart, byId])
  const discount = discounts.find((d) => d.id === discountId) ?? null
  const totals = useMemo(() => cartTotals(lines, discount), [lines, discount])
  const itemCount = Object.values(cart).reduce((a, b) => a + b, 0)

  // A discount that stops qualifying is dropped, with a note.
  useEffect(() => {
    if (!discount) return
    const res = evaluateDiscount(discount, lines)
    if (!res.qualifies) {
      setDroppedNote(`${discount.label} removed — ${res.note}`)
      setDiscountId(null)
    }
  }, [lines, discount])

  function add(p: PosProduct, n = 1): boolean {
    const left = remainingFor(p, cart, products)
    if (left < n) { toast.error(left <= 0 ? `No more ${splitName(p.name).title} left` : `Only ${left} more left`); return false }
    setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + n }))
    setCartOrder((o) => (o.includes(p.id) ? o : [...o, p.id]))
    return true
  }
  function dec(id: string) {
    setCart((c) => {
      const next = { ...c, [id]: (c[id] ?? 0) - 1 }
      if (next[id] <= 0) { delete next[id]; setCartOrder((o) => o.filter((x) => x !== id)) }
      return next
    })
  }
  function clearCart() { setCart({}); setCartOrder([]); setDiscountId(null); setDroppedNote(null) }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => chipMatches(p, chip === 'combos' ? 'all' : chip) &&
      (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)))
  }, [products, chip, query])

  // ── Session ───────────────────────────────────────────────────────────
  async function switchPerson() {
    if (itemCount > 0) { toast.error('Finish or clear the cart before switching person'); return }
    await api(`${base}/logout`, { method: 'POST' })
    setMe(null); setPicked(null); setView('grid'); setPhase('who'); loadState()
  }

  // ── Screens ───────────────────────────────────────────────────────────
  if (phase === 'loading') return <Centered><p className="text-gray-400 text-sm">Loading…</p></Centered>
  if (phase === 'notfound') return <Centered><p className="text-lg font-semibold">POS link not found</p><p className="text-sm text-gray-500 mt-1">Check the link with your supervisor.</p></Centered>
  if (phase === 'closed') return (
    <Centered>
      <Lock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <p className="text-lg font-semibold text-gray-900">This event is closed</p>
      {eventName && <p className="text-sm text-gray-500 mt-1">{eventName}</p>}
    </Centered>
  )

  if (phase === 'who') return (
    <div className="min-h-[100dvh] bg-white px-4 pt-10 pb-8">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-center">{eventName}</p>
      <h1 className="text-2xl font-bold text-gray-900 text-center mt-1 mb-6">Who&apos;s selling?</h1>
      {staff.length === 0 ? (
        <p className="text-sm text-gray-500 text-center">No part-timers on this event yet. Ask the admin to add you.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {staff.map((s) => (
            <button key={s.id} onClick={() => { setPicked(s); setPhase('pin') }}
              className="rounded-2xl border border-gray-200 bg-gray-50 active:bg-gray-100 py-6 px-3 flex flex-col items-center gap-2">
              <span className="w-12 h-12 rounded-full bg-[#008060] text-white text-lg font-bold flex items-center justify-center">{s.name.slice(0, 1).toUpperCase()}</span>
              <span className="text-sm font-semibold text-gray-900 text-center leading-tight">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (phase === 'pin' && picked) return (
    <PinPad
      name={picked.name}
      onBack={() => { setPicked(null); setPhase('who') }}
      onSubmit={async (pin) => {
        const r = await api<{ me: Staff }>(`${base}/login`, { method: 'POST', body: JSON.stringify({ staff_id: picked.id, pin }) })
        if (r.ok) { setMe(r.body.me); setPhase('sell'); return null }
        if ((r.body as { closed?: boolean }).closed) { setPhase('closed'); return null }
        return r.body.error ?? 'Could not sign in'
      }}
    />
  )

  if (!me) return null

  // ── Sell ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-gray-100 pb-28">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between px-3 pt-3 pb-2 gap-2">
          <button onClick={switchPerson} className="flex items-center gap-2 min-w-0 active:opacity-60" aria-label="Switch person">
            <span className="w-8 h-8 rounded-full bg-[#008060] text-white text-sm font-bold flex items-center justify-center shrink-0">{me.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-semibold text-gray-900 truncate">{me.name}</span>
              <span className="block text-[11px] text-gray-400 truncate">{eventName} · tap to switch</span>
            </span>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setView('sales')} className="h-9 px-3 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium">🧾 My sales</button>
            <button onClick={() => setView('shift')} className="h-9 px-3 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium">📊 My shift</button>
          </div>
        </div>
        <div className="px-3 pb-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or SKU"
              className="w-full h-10 rounded-lg bg-gray-100 pl-9 pr-8 text-[16px] focus:outline-none focus:ring-2 focus:ring-[#008060]" />
            {query && <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400"><X className="w-4 h-4" /></button>}
          </div>
          <button onClick={() => { primeScannerAudio(); setScanning(true) }} className="h-10 w-11 rounded-lg bg-gray-100 active:bg-gray-200 flex items-center justify-center" aria-label="Scan barcode">
            <ScanLine className="w-5 h-5 text-gray-700" />
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {POS_CHIPS.map((c) => (
            <button key={c.key} onClick={() => setChip(c.key)}
              className={cn('shrink-0 h-8 px-3.5 rounded-full text-sm font-medium border',
                chip === c.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200')}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {chip === 'combos' ? (
        <div className="p-3">
          <DiscountList discounts={discounts} lines={lines} selected={discountId}
            onPick={(id) => { setDiscountId(id === discountId ? null : id); setDroppedNote(null) }} />
        </div>
      ) : (
        <div className="p-3 grid grid-cols-2 gap-2.5">
          {shown.length === 0 && <p className="col-span-2 text-center text-sm text-gray-400 py-10">{products.length ? 'Nothing matches' : 'No stock at this event yet'}</p>}
          {shown.map((p) => {
            const left = remainingFor(p, cart, products)
            // Patches have no stock at events: never sold out, no "N left".
            const out = !p.unlimited && (p.left <= 0 || (left <= 0 && !(cart[p.id] > 0)))
            const inCart = cart[p.id] ?? 0
            const n = splitName(p.name)
            return (
              <button key={p.id} disabled={out} onClick={() => add(p)}
                className={cn('relative bg-white rounded-xl overflow-hidden text-left border border-gray-200 active:scale-[0.98] transition-transform', out && 'opacity-40 grayscale')}>
                <div className="aspect-square bg-gray-50">
                  {p.image_url
                    ? <img src={p.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-3xl text-gray-300">🧦</div>}
                </div>
                {inCart > 0 && <span className="absolute top-2 right-2 min-w-7 h-7 px-1.5 rounded-full bg-[#008060] text-white text-sm font-bold flex items-center justify-center shadow">{inCart}</span>}
                <div className="p-2.5">
                  <p className="text-[13px] font-semibold text-gray-900 leading-tight line-clamp-2">{n.title}</p>
                  {n.series && <p className="text-[11px] text-gray-400 truncate">{n.series}</p>}
                  <p className="text-[11px] text-gray-400 font-mono truncate">{p.sku}</p>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-sm font-bold text-gray-900">{p.price === 0 ? 'FREE' : rm(p.price)}</span>
                    {!p.unlimited && (
                      <span className={cn('text-[11px] font-medium', out ? 'text-red-500' : left <= 2 ? 'text-amber-600' : 'text-gray-500')}>
                        {out ? 'Sold out' : `${left} left`}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* View cart bar */}
      {itemCount > 0 && view === 'grid' && !checkout && (
        <div className="fixed bottom-0 inset-x-0 z-30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-gray-100 via-gray-100/90">
          <button onClick={() => setView('cart')} className="w-full h-14 rounded-xl bg-[#008060] active:bg-[#006e52] text-white font-semibold text-base flex items-center justify-between px-5 shadow-lg">
            <span>View cart · {totals.pairs} pair{totals.pairs === 1 ? '' : 's'}</span>
            <span>{rm(totals.total)}</span>
          </button>
        </div>
      )}

      {/* Cart */}
      {view === 'cart' && (
        <FullScreen title="Cart" onBack={() => setView('grid')}
          right={itemCount > 0 ? <button onClick={() => { if (confirm('Clear the cart?')) clearCart() }} className="text-sm font-medium text-red-600 px-2">Clear</button> : null}>
          {itemCount === 0 ? <p className="text-center text-gray-400 text-sm py-16">Cart is empty</p> : (
            <>
              <div className="bg-white divide-y divide-gray-100">
                {cartOrder.map((id) => {
                  const p = byId.get(id); const qty = cart[id] ?? 0
                  if (!p || !qty) return null
                  const n = splitName(p.name)
                  return (
                    <div key={id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-12 h-12 rounded-lg bg-gray-50 overflow-hidden shrink-0">
                        {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center">🧦</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{n.title}</p>
                        <p className="text-xs text-gray-400 truncate">{p.sku} · {p.price === 0 ? 'FREE' : rm(p.price)}{!p.is_pair ? ' · add-on' : ''}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => dec(id)} className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center active:bg-gray-100"><Minus className="w-4 h-4" /></button>
                        <span className="w-6 text-center font-semibold tabular-nums">{qty}</span>
                        <button onClick={() => add(p)} className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center active:bg-gray-100"><Plus className="w-4 h-4" /></button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="px-4 pt-4">
                <button onClick={() => setDiscountPicker(true)} className="w-full h-11 rounded-lg border border-dashed border-gray-300 bg-white text-sm font-medium text-gray-700 active:bg-gray-50">
                  {discount ? `Discount: ${discount.label} · change` : '+ Add discount'}
                </button>
                {droppedNote && <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{droppedNote}</p>}
              </div>

              <div className="bg-white mt-4 px-4 py-3 space-y-1.5 text-sm">
                <Row label={`Subtotal · ${totals.pairs} pair${totals.pairs === 1 ? '' : 's'}`} value={rm(totals.subtotal)} />
                {discount && <Row label={discount.label} value={`−${rm(totals.discount_amount)}`} green action={<button onClick={() => setDiscountId(null)} className="ml-2 text-gray-400"><X className="w-3.5 h-3.5" /></button>} />}
                <div className="flex justify-between text-lg font-bold pt-1.5 border-t border-gray-100"><span>Total</span><span>{rm(totals.total)}</span></div>
              </div>
              <div className="h-24" />
              <div className="fixed bottom-0 inset-x-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t border-gray-200">
                <button onClick={() => setCheckout(true)} className="w-full h-14 rounded-xl bg-[#008060] active:bg-[#006e52] text-white font-semibold text-base">
                  Checkout · {rm(totals.total)}
                </button>
              </div>
            </>
          )}
        </FullScreen>
      )}

      {discountPicker && (
        <Sheet title="Add discount" onClose={() => setDiscountPicker(false)}>
          <DiscountList discounts={discounts} lines={lines} selected={discountId}
            onPick={(id) => { setDiscountId(id === discountId ? null : id); setDroppedNote(null); setDiscountPicker(false) }} />
        </Sheet>
      )}

      {checkout && (
        <CheckoutSheet
          total={totals.total}
          onClose={() => setCheckout(false)}
          onSubmit={async (method, cash, key) => {
            const r = await api<{ sale_no: number; total: number; change: number | null }>(`${base}/sale`, {
              method: 'POST',
              body: JSON.stringify({
                idempotency_key: key,
                items: cartOrder.filter((id) => cart[id] > 0).map((id) => ({ id, qty: cart[id] })),
                discount_id: discountId,
                payment_method: method,
                cash_received: method === 'cash' ? cash : null,
              }),
            })
            if (r.status === 401) { toast.error('Signed out — sign in again'); setMe(null); setCheckout(false); loadState(); return null }
            if (!r.ok) {
              if (r.status === 409) loadCatalog()
              return { error: r.body.error ?? 'Sale failed' }
            }
            return { sale_no: r.body.sale_no, total: r.body.total, change: r.body.change }
          }}
          onDone={() => { clearCart(); setCheckout(false); setView('grid'); setQuery(''); loadCatalog() }}
        />
      )}

      {view === 'sales' && <MySales base={base} onBack={() => setView('grid')} />}
      {view === 'shift' && <MyShift base={base} name={me.name} onBack={() => setView('grid')} />}

      <BarcodeScanner
        open={scanning}
        mode="continuous"
        title="Scan to add"
        hint="Point at the barcode on the tag"
        onClose={() => setScanning(false)}
        onDetect={(code) => {
          const p = findByBarcode(products.filter((x) => x.barcode), code)
          if (!p) return { tone: 'error', title: 'Not at this event', detail: code }
          const ok = add(p)
          return ok
            ? { tone: 'ok', title: splitName(p.name).title, detail: `${rm(p.price)} · added`, imageUrl: p.image_url }
            : { tone: 'warn', title: splitName(p.name).title, detail: 'No more left at this event', imageUrl: p.image_url }
        }}
      />
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-white flex items-center justify-center px-6 text-center"><div>{children}</div></div>
}

function Row({ label, value, green, action }: { label: string; value: string; green?: boolean; action?: React.ReactNode }) {
  return (
    <div className={cn('flex justify-between items-center', green ? 'text-[#008060]' : 'text-gray-600')}>
      <span className="flex items-center">{label}{action}</span><span>{value}</span>
    </div>
  )
}

function FullScreen({ title, onBack, right, children }: { title: string; onBack: () => void; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 bg-gray-100 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 h-14 flex items-center justify-between px-2">
        <button onClick={onBack} className="flex items-center gap-0.5 text-[#008060] font-medium px-2 h-10"><ChevronLeft className="w-5 h-5" /> Back</button>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <div className="min-w-[64px] flex justify-end">{right}</div>
      </div>
      {children}
    </div>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-gray-50 rounded-t-2xl max-h-[88dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="sticky top-0 bg-gray-50 flex items-center justify-between px-4 h-14 border-b border-gray-200">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3">{children}</div>
      </div>
    </div>
  )
}

function DiscountList({ discounts, lines, selected, onPick }: { discounts: PosDiscount[]; lines: DiscountLine[]; selected: string | null; onPick: (id: string) => void }) {
  if (!discounts.length) return <p className="text-center text-sm text-gray-400 py-10">No discounts set up</p>
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {discounts.map((d) => {
        const r = evaluateDiscount(d, lines)
        const isSel = selected === d.id
        return (
          <button key={d.id} disabled={!r.qualifies && !isSel} onClick={() => onPick(d.id)}
            className={cn('rounded-xl border-2 p-3 text-left min-h-[84px] flex flex-col justify-between bg-white',
              isSel ? 'border-[#008060] bg-green-50' : r.qualifies ? 'border-gray-200 active:bg-gray-50' : 'border-gray-100 opacity-60')}>
            <span className="text-sm font-bold text-gray-900 leading-tight">{d.label}</span>
            <span className={cn('text-xs mt-1 font-medium', isSel ? 'text-[#008060]' : r.qualifies ? 'text-[#008060]' : 'text-gray-400')}>
              {isSel ? `✓ Applied · ${r.note}` : r.qualifies ? `Qualifies · ${r.note}` : r.note}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PinPad({ name, onBack, onSubmit }: { name: string; onBack: () => void; onSubmit: (pin: string) => Promise<string | null> }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitted = useRef(false)

  useEffect(() => {
    if (pin.length !== 4 || submitted.current) return
    submitted.current = true
    setBusy(true)
    onSubmit(pin).then((err) => {
      setBusy(false); submitted.current = false
      if (err) { setError(err); setPin('') }
    })
  }, [pin, onSubmit])

  const press = (k: string) => { if (busy) return; setError(null); setPin((p) => (p.length < 4 ? p + k : p)) }
  return (
    <div className="min-h-[100dvh] bg-white flex flex-col px-6 pt-4 pb-8">
      <button onClick={onBack} className="self-start flex items-center gap-0.5 text-[#008060] font-medium h-10"><ChevronLeft className="w-5 h-5" /> Back</button>
      <div className="flex-1 flex flex-col items-center justify-center">
        <span className="w-14 h-14 rounded-full bg-[#008060] text-white text-xl font-bold flex items-center justify-center">{name.slice(0, 1).toUpperCase()}</span>
        <p className="mt-3 text-lg font-semibold text-gray-900">{name}</p>
        <p className="text-sm text-gray-500">Enter your 4-digit PIN</p>
        <div className="flex gap-4 my-6">
          {[0, 1, 2, 3].map((i) => <span key={i} className={cn('w-4 h-4 rounded-full border-2', i < pin.length ? 'bg-gray-900 border-gray-900' : 'border-gray-300')} />)}
        </div>
        <p className={cn('h-5 text-sm', error ? 'text-red-600' : 'text-gray-400')}>{error ?? (busy ? 'Checking…' : '')}</p>
      </div>
      <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto w-full">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} onClick={() => press(k)} className="h-16 rounded-2xl bg-gray-100 active:bg-gray-200 text-2xl font-semibold">{k}</button>
        ))}
        <span />
        <button onClick={() => press('0')} className="h-16 rounded-2xl bg-gray-100 active:bg-gray-200 text-2xl font-semibold">0</button>
        <button onClick={() => !busy && setPin((p) => p.slice(0, -1))} className="h-16 rounded-2xl active:bg-gray-100 flex items-center justify-center" aria-label="Delete"><Delete className="w-6 h-6 text-gray-600" /></button>
      </div>
    </div>
  )
}

type SubmitResult = { sale_no: number; total: number; change: number | null } | { error: string } | null

function CheckoutSheet({ total, onClose, onSubmit, onDone }: {
  total: number
  onClose: () => void
  onSubmit: (method: Pay, cash: number | null, key: string) => Promise<SubmitResult>
  onDone: () => void
}) {
  const [method, setMethod] = useState<Pay>('cash')
  const [cash, setCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ sale_no: number; total: number; change: number | null } | null>(null)
  // One key per checkout: a double tap or a retry after a dropped connection
  // can never record the sale twice.
  const key = useRef(newKey())

  const cashNum = Number(cash) || 0
  const enough = cashNum + 0.0001 >= total
  const quick = useMemo(() => {
    const opts = new Set<number>([Math.round(total * 100) / 100])
    for (const step of [10, 50, 100]) opts.add(Math.ceil(total / step) * step)
    return [...opts].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 4)
  }, [total])

  async function complete() {
    if (busy) return
    setBusy(true); setError(null)
    const r = await onSubmit(method, method === 'cash' ? cashNum : null, key.current)
    setBusy(false)
    if (!r) return
    if ('error' in r) { setError(r.error); return }
    setDone(r)
  }

  if (done) return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center px-6 text-center">
      <span className="w-20 h-20 rounded-full bg-[#008060] flex items-center justify-center"><Check className="w-10 h-10 text-white" strokeWidth={3} /></span>
      <h2 className="text-2xl font-bold text-gray-900 mt-5">Sale complete</h2>
      <p className="text-gray-500 mt-1">Sale #{done.sale_no} · {rm(done.total)} · {PAY_LABEL[method]}</p>
      {method === 'cash' && done.change != null && (
        <div className="mt-6 rounded-2xl bg-yellow-50 px-8 py-4">
          <p className="text-sm text-gray-600">Change to give</p>
          <p className="text-4xl font-extrabold text-gray-900">{rm(done.change)}</p>
        </div>
      )}
      <button onClick={onDone} className="mt-10 w-full max-w-sm h-14 rounded-xl bg-[#008060] active:bg-[#006e52] text-white font-semibold text-base">New sale</button>
    </div>
  )

  return (
    <Sheet title="Checkout" onClose={() => !busy && onClose()}>
      <div className="text-center py-2">
        <p className="text-sm text-gray-500">Total</p>
        <p className="text-4xl font-extrabold text-gray-900">{rm(total)}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        {(['cash', 'card', 'qr'] as Pay[]).map((m) => (
          <button key={m} onClick={() => { setMethod(m); setError(null) }}
            className={cn('h-12 rounded-xl border-2 font-semibold', method === m ? 'border-[#008060] bg-green-50 text-[#008060]' : 'border-gray-200 bg-white text-gray-700')}>
            {m === 'cash' ? '💵 Cash' : m === 'card' ? '💳 Card' : '📱 QR'}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {method === 'cash' && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              {quick.map((v) => (
                <button key={v} onClick={() => setCash(v.toFixed(2))} className="h-11 rounded-lg bg-white border border-gray-200 text-sm font-semibold active:bg-gray-100">
                  {v === total ? 'Exact' : `RM${v}`}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Cash received (RM)</span>
              <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00"
                className="mt-1 w-full h-12 rounded-lg border border-gray-300 px-3 text-xl font-semibold text-[16px] focus:outline-none focus:ring-2 focus:ring-[#008060]" />
            </label>
            <div className="flex justify-between text-base">
              <span className="text-gray-600">Change</span>
              <span className={cn('font-bold', enough ? 'text-gray-900' : 'text-gray-300')}>{enough ? rm(cashNum - total) : '—'}</span>
            </div>
          </div>
        )}
        {method === 'card' && <p className="rounded-lg bg-white border border-gray-200 p-4 text-sm text-gray-700">Charge <b>{rm(total)}</b> on the terminal, then tap <b>Payment received</b>.</p>}
        {method === 'qr' && <p className="rounded-lg bg-white border border-gray-200 p-4 text-sm text-gray-700">Customer scans the Xocks DuitNow QR. Check <b>{rm(total)}</b> arrived, then tap <b>Payment received</b>.</p>}
      </div>

      {error && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <button onClick={complete} disabled={busy || (method === 'cash' && !enough)}
        className="mt-4 w-full h-14 rounded-xl bg-[#008060] active:bg-[#006e52] text-white font-semibold text-base disabled:opacity-40">
        {busy ? 'Recording…' : method === 'cash' ? 'Complete sale' : 'Payment received'}
      </button>
    </Sheet>
  )
}

function MySales({ base, onBack }: { base: string; onBack: () => void }) {
  const [day, setDay] = useState<string>('')
  const [data, setData] = useState<MySalesData | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    api<MySalesData>(`${base}/my-sales${day ? `?day=${day}` : ''}`).then((r) => {
      if (r.ok) setData(r.body); else toast.error(r.body.error ?? 'Could not load')
    })
  }, [base, day])

  const current = data?.day ?? ''
  const filters = data ? [
    { key: data.today, label: 'Today' },
    ...data.days.filter((d) => d !== data.today).map((d) => ({ key: d, label: dayLabel(d) })),
    { key: 'all', label: 'Whole event' },
  ] : []

  return (
    <FullScreen title="🧾 My sales" onBack={onBack}>
      <div className="flex gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map((f) => (
          <button key={f.key} onClick={() => setDay(f.key)}
            className={cn('shrink-0 h-8 px-3.5 rounded-full text-sm font-medium border', current === f.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700')}>
            {f.label}
          </button>
        ))}
      </div>
      {!data ? <p className="text-center text-sm text-gray-400 py-10">Loading…</p> : (
        <>
          <div className="mx-3 grid grid-cols-4 gap-2">
            <Tile label="Sales" value={String(data.totals.count)} />
            <Tile label="Pairs" value={String(data.totals.pairs)} />
            <Tile label="Total" value={rm(data.totals.total)} />
            <Tile label="Discounts" value={rm(data.totals.discounts)} />
          </div>
          <div className="mt-3 bg-white divide-y divide-gray-100">
            {data.sales.length === 0 && <p className="text-center text-sm text-gray-400 py-10">No sales yet</p>}
            {data.sales.map((s) => (
              <div key={s.id}>
                <button onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                  <div>
                    <p className={cn('text-sm font-semibold text-gray-900', s.voided && 'line-through text-gray-400')}>#{s.sale_no} · {PAY_LABEL[s.payment_method]}{s.voided ? ' · voided' : ''}</p>
                    <p className="text-xs text-gray-400">{current === 'all' ? `${dayLabel(s.event_day)} ` : ''}{timeMY(s.created_at)} · {s.items.reduce((a, i) => a + (i.is_pair ? i.qty : 0), 0)} pairs{s.discount_label ? ` · ${s.discount_label}` : ''}</p>
                  </div>
                  <span className={cn('font-semibold', s.voided && 'line-through text-gray-400')}>{rm(s.total)}</span>
                </button>
                {open === s.id && (
                  <div className="px-4 pb-3 space-y-1">
                    {s.items.map((i, k) => (
                      <div key={k} className="flex justify-between text-xs text-gray-600"><span>{i.qty} × {splitName(i.name).title}</span><span>{rm(i.qty * i.unit_price)}</span></div>
                    ))}
                    {s.discount_amount > 0 && <div className="flex justify-between text-xs text-[#008060]"><span>{s.discount_label}</span><span>−{rm(s.discount_amount)}</span></div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </FullScreen>
  )
}

function MyShift({ base, name, onBack }: { base: string; name: string; onBack: () => void }) {
  const [data, setData] = useState<ShiftData | null>(null)
  useEffect(() => {
    api<ShiftData>(`${base}/my-shift`).then((r) => { if (r.ok) setData(r.body); else toast.error(r.body.error ?? 'Could not load') })
  }, [base])

  const b = data?.bonus
  const top = b ? Math.max(...b.tiers.map((t) => t.mark), 1) : 1
  return (
    <FullScreen title="📊 My shift" onBack={onBack}>
      {!data ? <p className="text-center text-sm text-gray-400 py-10">Loading…</p> : (
        <div className="p-3 space-y-3">
          <p className="text-sm text-gray-500 px-1">{name} · today</p>
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Sales" value={String(data.sales_count)} />
            <Tile label="Pairs" value={String(data.pairs)} />
            <Tile label="Total" value={rm(data.total)} />
            <Tile label="Discounts given" value={rm(data.discounts)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="💵 Cash" value={rm(data.split.cash)} />
            <Tile label="💳 Card" value={rm(data.split.card)} />
            <Tile label="📱 QR" value={rm(data.split.qr)} />
          </div>

          {b ? (
            <div className="bg-white rounded-xl p-4">
              <div className="flex justify-between items-baseline">
                <p className="text-sm font-semibold text-gray-900">Bonus · {b.day_label}</p>
                <p className="text-sm text-gray-500">{rm(b.progress)} toward bonus</p>
              </div>
              <div className="relative h-4 bg-gray-100 rounded-full mt-6 mb-8">
                <div className="absolute inset-y-0 left-0 bg-[#008060] rounded-full" style={{ width: `${Math.min(100, (b.progress / top) * 100)}%` }} />
                {b.tiers.filter((t) => t.mark > 0).map((t) => (
                  <div key={t.tier} className="absolute top-0 h-4" style={{ left: `${(t.mark / top) * 100}%` }}>
                    <div className="w-0.5 h-4 bg-gray-700 -translate-x-1/2" />
                    <div className={cn('absolute -top-5 -translate-x-1/2 text-[10px] font-bold whitespace-nowrap', t.hit ? 'text-[#008060]' : 'text-gray-500')}>{t.hit ? '✓ ' : ''}T{t.tier}</div>
                    <div className="absolute top-5 -translate-x-1/2 text-[10px] text-gray-500 whitespace-nowrap">RM{t.mark}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                {b.tiers.map((t) => (
                  <div key={t.tier} className="flex justify-between text-sm">
                    <span className={t.hit ? 'text-[#008060] font-semibold' : 'text-gray-500'}>{t.hit ? '✅' : '⬜'} Tier {t.tier} · RM{t.mark}</span>
                    <span className={t.hit ? 'text-[#008060] font-semibold' : 'text-gray-500'}>RM{t.bonus}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg bg-yellow-50 px-4 py-3 flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">Bonus earned today</span>
                <span className="text-xl font-extrabold text-gray-900">RM{b.earned}</span>
              </div>
              {b.next && <p className="mt-2 text-sm text-center text-gray-600">{rm(b.next.more)} more to reach Tier {b.next.tier}</p>}
            </div>
          ) : (
            <div className="bg-white rounded-xl p-4 text-sm text-gray-500 text-center">No bonus targets for today.</div>
          )}
        </div>
      )}
    </FullScreen>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-base font-bold text-gray-900 truncate">{value}</p>
    </div>
  )
}
