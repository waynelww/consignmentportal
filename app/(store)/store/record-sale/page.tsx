'use client'

import { useEffect, useState, useMemo } from 'react'
import { X, ShoppingCart, CheckCircle, Loader2, Search, Minus, Plus, Trash2, Tag, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import type { StoreInventory, Promo } from '@/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/components/store/StoreContext'

interface CartItem {
  inventoryItem: StoreInventory
  quantity: number
}

type PageStep = 'select' | 'success'

export default function RecordSalePage() {
  const { storeId } = useStore()

  const [inventory, setInventory] = useState<StoreInventory[]>([])
  const [loadingInventory, setLoadingInventory] = useState(true)
  const [step, setStep] = useState<PageStep>('select')

  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [successInfo, setSuccessInfo] = useState<{ pairs: number; total: number; discount: number } | null>(null)

  // Promos
  const [promos, setPromos] = useState<Promo[]>([])
  const [selectedPromo, setSelectedPromo] = useState<Promo | null>(null)
  const [promoPickerOpen, setPromoPickerOpen] = useState(false)
  const [promoCode, setPromoCode] = useState('')

  const [search, setSearch] = useState('')

  // Load inventory + promos in parallel
  useEffect(() => {
    if (!storeId) return
    async function load() {
      const supabase = createClient()
      const [invRes, promosRes] = await Promise.all([
        supabase
          .from('store_inventory')
          .select('*, product:products(*)')
          .eq('store_id', storeId!)
          .order('quantity_on_hand', { ascending: false }),
        fetch(`/api/promos?store_id=${storeId}`).then((r) => r.json()).catch(() => ({ promos: [] })),
      ])
      setInventory((invRes.data as StoreInventory[]) ?? [])
      const allPromos = (promosRes.promos ?? []) as Promo[]
      // Show only active and non-expired
      setPromos(
        allPromos.filter((p) => {
          if (!p.is_active) return false
          if (p.expires_at && new Date(p.expires_at) < new Date()) return false
          return true
        })
      )
      setLoadingInventory(false)
    }
    load()
  }, [storeId])

  // Only show in-stock items, filtered by search
  const visibleInventory = useMemo(() => {
    const inStock = inventory.filter((i) => i.quantity_on_hand > 0)
    if (!search.trim()) return inStock
    const q = search.trim().toLowerCase()
    return inStock.filter((i) =>
      i.product?.name?.toLowerCase().includes(q) ||
      i.product?.sku?.toLowerCase().includes(q)
    )
  }, [inventory, search])

  // Cart helpers
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0)
  const cartSubtotal = cart.reduce((s, c) => s + (c.inventoryItem.product?.selling_price ?? 0) * c.quantity, 0)

  // Promo discount calculation + eligibility check
  function promoEligibility(promo: Promo): { ok: boolean; reason?: string } {
    if (cartCount < promo.min_quantity) return { ok: false, reason: `Need ${promo.min_quantity} pairs (have ${cartCount})` }
    if (cartSubtotal < Number(promo.min_amount)) return { ok: false, reason: `Need ${formatCurrency(Number(promo.min_amount))} minimum` }
    if (promo.discount_type === 'bxgy') {
      const needed = (promo.buy_quantity ?? 0) + (promo.free_quantity ?? 0)
      if (cartCount < needed) return { ok: false, reason: `Need ${needed} pairs (have ${cartCount})` }
    }
    return { ok: true }
  }

  const promoDiscount = (() => {
    if (!selectedPromo) return 0
    const eligibility = promoEligibility(selectedPromo)
    if (!eligibility.ok) return 0
    if (selectedPromo.discount_type === 'percentage') {
      return Number((cartSubtotal * Number(selectedPromo.discount_value) / 100).toFixed(2))
    }
    if (selectedPromo.discount_type === 'fixed') {
      return Math.min(Number(selectedPromo.discount_value), cartSubtotal)
    }
    if (selectedPromo.discount_type === 'bxgy') {
      // Take the cheapest `free_quantity` pairs across the cart
      const freeQ = selectedPromo.free_quantity ?? 0
      const pairPrices: number[] = []
      for (const c of cart) {
        const price = c.inventoryItem.product?.selling_price ?? 0
        for (let i = 0; i < c.quantity; i++) pairPrices.push(price)
      }
      pairPrices.sort((a, b) => a - b)
      return Number(pairPrices.slice(0, freeQ).reduce((s, p) => s + p, 0).toFixed(2))
    }
    return 0
  })()

  const cartTotal = Math.max(0, cartSubtotal - promoDiscount)

  function applyPromoCode() {
    const code = promoCode.trim().toUpperCase()
    if (!code) return
    const match = promos.find((p) => p.code?.toUpperCase() === code)
    if (!match) {
      toast.error('Promo code not found')
      return
    }
    const eligibility = promoEligibility(match)
    if (!eligibility.ok) {
      toast.error(eligibility.reason ?? 'Promo not eligible')
      return
    }
    setSelectedPromo(match)
    setPromoPickerOpen(false)
    setPromoCode('')
    toast.success(`${match.name} applied`)
  }

  function selectPromo(promo: Promo) {
    const eligibility = promoEligibility(promo)
    if (!eligibility.ok) {
      toast.error(eligibility.reason ?? 'Promo not eligible')
      return
    }
    setSelectedPromo(promo)
    setPromoPickerOpen(false)
    setPromoCode('')
    toast.success(`${promo.name} applied`)
  }

  function clearPromo() {
    setSelectedPromo(null)
    setPromoCode('')
  }

  function addToCart(item: StoreInventory) {
    setCart((prev) => {
      const existing = prev.find((c) => c.inventoryItem.product_id === item.product_id)
      if (existing) {
        const inv = inventory.find((i) => i.product_id === item.product_id)
        const maxQty = inv?.quantity_on_hand ?? existing.quantity
        if (existing.quantity >= maxQty) {
          toast.error(`Max stock reached (${maxQty} available)`)
          return prev
        }
        return prev.map((c) =>
          c.inventoryItem.product_id === item.product_id
            ? { ...c, quantity: c.quantity + 1 }
            : c
        )
      }
      return [...prev, { inventoryItem: item, quantity: 1 }]
    })
  }

  function setCartQty(productId: string, qty: number) {
    if (qty <= 0) {
      removeFromCart(productId)
      return
    }
    const inv = inventory.find((i) => i.product_id === productId)
    const maxQty = inv?.quantity_on_hand ?? qty
    setCart((prev) =>
      prev.map((c) =>
        c.inventoryItem.product_id === productId
          ? { ...c, quantity: Math.min(qty, maxQty) }
          : c
      )
    )
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((c) => c.inventoryItem.product_id !== productId))
  }

  async function confirmOrder() {
    if (!storeId || cart.length === 0) return
    setSubmitting(true)

    try {
      const res = await fetch('/api/sales/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          items: cart.map((c) => ({
            product_id: c.inventoryItem.product_id,
            quantity: c.quantity,
          })),
          promo_id: selectedPromo?.id ?? null,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? 'Failed to record sale')
      }

      const data = await res.json()
      setSuccessInfo({
        pairs: data.total_pairs,
        total: data.grand_total,
        discount: data.promo_discount ?? promoDiscount,
      })
      setCartOpen(false)
      setCart([])
      setSelectedPromo(null)
      setPromoCode('')
      setStep('success')
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to record sale. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success screen ──
  if (step === 'success' && successInfo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
          <CheckCircle size={40} className="text-[#22C55E]" />
        </div>
        <h2 className="text-2xl font-bold text-[#0A0A0A]">Order Recorded!</h2>
        <p className="text-gray-500 mt-2">{successInfo.pairs} pair{successInfo.pairs !== 1 ? 's' : ''} sold</p>
        {successInfo.discount > 0 && (
          <p className="text-xs text-amber-600 mt-2 font-semibold">
            Promo discount: −{formatCurrency(successInfo.discount)}
          </p>
        )}
        <p className="text-3xl font-bold text-[#0A0A0A] mt-3">{formatCurrency(successInfo.total)}</p>
        <button
          onClick={() => setStep('select')}
          className="mt-8 w-full max-w-xs h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-bold text-base"
        >
          Record Another Sale
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#0A0A0A]">Record a Sale</h1>

        {/* Cart button */}
        <button
          onClick={() => cart.length > 0 && setCartOpen(true)}
          className={cn(
            'relative flex items-center gap-1.5 h-10 px-3 rounded-xl font-semibold text-sm transition-all',
            cartCount > 0
              ? 'bg-[#0A0A0A] text-[#FFD700]'
              : 'bg-gray-100 text-gray-400 cursor-default',
          )}
        >
          <ShoppingCart size={18} />
          {cartCount > 0 && (
            <span className="text-sm font-bold">{cartCount}</span>
          )}
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or SKU…"
          className="w-full h-12 pl-9 pr-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] bg-white"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Product grid — 3 columns */}
      {loadingInventory ? (
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-36 bg-gray-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : visibleInventory.length === 0 ? (
        <p className="text-center text-gray-400 py-10">
          {search ? 'No products match your search.' : 'No products in stock.'}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {visibleInventory.map((item) => {
            const imgUrl = item.product?.image_url
            const cartItem = cart.find((c) => c.inventoryItem.product_id === item.product_id)
            const inCart = cartItem ? cartItem.quantity : 0

            return (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                className="relative bg-white rounded-xl shadow-sm text-left transition-all active:scale-95 hover:shadow-md cursor-pointer overflow-hidden"
              >
                {/* Product image */}
                <div className="w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                  {imgUrl ? (
                    <Image
                      src={imgUrl}
                      alt={item.product?.name ?? ''}
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
                </div>

                {/* Cart badge overlay */}
                {inCart > 0 && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#FFD700] flex items-center justify-center">
                    <span className="text-[10px] font-black text-[#0A0A0A]">{inCart}</span>
                  </div>
                )}

                <div className="p-2">
                  <p className="text-xs font-bold text-[#0A0A0A] leading-tight line-clamp-2">
                    {item.product?.name}
                  </p>
                  <p className="text-[10px] font-mono text-gray-400 truncate mt-0.5">{item.product?.sku}</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs font-semibold text-[#0A0A0A]">
                      {formatCurrency(item.product?.selling_price ?? 0)}
                    </p>
                    <span className="text-[9px] text-gray-400">{item.quantity_on_hand}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Sticky confirm bar when cart has items */}
      {cartCount > 0 && (
        <div className="fixed bottom-[72px] left-0 right-0 px-4 pb-2 z-40">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full max-w-lg mx-auto flex items-center justify-between h-14 rounded-xl bg-[#0A0A0A] text-white px-5 shadow-xl"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-[#FFD700]" />
              <span className="font-semibold text-sm">{cartCount} item{cartCount !== 1 ? 's' : ''}</span>
            </div>
            <span className="font-bold text-[#FFD700]">{formatCurrency(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setCartOpen(false)}
          />

          {/* Drawer — pinned above bottom nav (72px tall) */}
          <div className="relative bg-white rounded-t-2xl max-h-[80vh] flex flex-col shadow-2xl mb-[72px]">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
              <h2 className="text-base font-bold text-[#0A0A0A]">Cart</h2>
              <button
                onClick={() => setCartOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            {/* Items list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {cart.map((cartItem) => {
                const item = cartItem.inventoryItem
                const maxQty = inventory.find((i) => i.product_id === item.product_id)?.quantity_on_hand ?? cartItem.quantity
                const subtotal = (item.product?.selling_price ?? 0) * cartItem.quantity

                return (
                  <div key={item.product_id} className="flex items-center gap-3">
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                      {item.product?.image_url ? (
                        <Image
                          src={item.product.image_url}
                          alt={item.product?.name ?? ''}
                          width={48}
                          height={48}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-xs font-black text-gray-300">{item.product?.sku?.slice(0, 3)}</span>
                        </div>
                      )}
                    </div>

                    {/* Name + SKU */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#0A0A0A] truncate">{item.product?.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{item.product?.sku}</p>
                      <p className="text-xs font-semibold text-[#0A0A0A] mt-0.5">{formatCurrency(subtotal)}</p>
                    </div>

                    {/* Qty controls */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setCartQty(item.product_id, cartItem.quantity - 1)}
                        className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{cartItem.quantity}</span>
                      <button
                        onClick={() => setCartQty(item.product_id, cartItem.quantity + 1)}
                        disabled={cartItem.quantity >= maxQty}
                        className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors disabled:opacity-40"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        onClick={() => removeFromCart(item.product_id)}
                        className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center hover:bg-red-100 transition-colors ml-0.5"
                      >
                        <Trash2 size={12} className="text-red-500" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer — promo + totals + confirm */}
            <div className="px-4 pt-3 pb-6 border-t border-gray-100 space-y-3 shrink-0">
              {/* Promo button */}
              {selectedPromo ? (
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tag size={14} className="text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-amber-900 truncate">{selectedPromo.name}</p>
                      <p className="text-[10px] text-amber-700">
                        −{formatCurrency(promoDiscount)}
                      </p>
                    </div>
                  </div>
                  <button onClick={clearPromo} className="text-amber-700 hover:text-amber-900 shrink-0">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setPromoPickerOpen(true)}
                  disabled={promos.length === 0}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-xl border border-dashed transition-colors',
                    promos.length === 0
                      ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                      : 'border-amber-300 text-amber-700 hover:bg-amber-50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Tag size={14} />
                    <span className="text-xs font-semibold">
                      {promos.length === 0 ? 'No active promos' : 'Apply Promo'}
                    </span>
                  </div>
                  {promos.length > 0 && <ChevronRight size={14} />}
                </button>
              )}

              {/* Totals */}
              <div className="space-y-0.5">
                {promoDiscount > 0 && (
                  <>
                    <div className="flex justify-between items-center text-xs text-gray-500">
                      <span>Subtotal</span>
                      <span>{formatCurrency(cartSubtotal)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-amber-600 font-semibold">
                      <span>Promo discount</span>
                      <span>−{formatCurrency(promoDiscount)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">{cartCount} pair{cartCount !== 1 ? 's' : ''}</span>
                  <span className="text-lg font-bold text-[#0A0A0A]">{formatCurrency(cartTotal)}</span>
                </div>
              </div>
              <button
                onClick={confirmOrder}
                disabled={submitting}
                className={cn(
                  'w-full h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-bold text-base flex items-center justify-center gap-2',
                  submitting ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90 active:scale-95 transition-all',
                )}
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Recording…
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    Confirm Order
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promo picker drawer */}
      {promoPickerOpen && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPromoPickerOpen(false)} />
          <div className="relative bg-white rounded-t-2xl max-h-[75vh] flex flex-col shadow-2xl mb-[72px]">
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
              <h2 className="text-base font-bold text-[#0A0A0A]">Apply Promo</h2>
              <button
                onClick={() => setPromoPickerOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            {/* Code entry */}
            <div className="px-4 pt-3 pb-2 shrink-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Have a code?</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyPromoCode() }}
                  placeholder="Enter code"
                  className="flex-1 h-11 px-3 text-sm font-mono uppercase border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <button
                  onClick={applyPromoCode}
                  disabled={!promoCode.trim()}
                  className="px-4 h-11 rounded-xl bg-[#0A0A0A] text-[#FFD700] text-sm font-bold disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Promo list */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Available promos {promos.length > 0 && `(${promos.length})`}
              </p>
              {promos.length === 0 ? (
                <div className="text-center py-8">
                  <Tag size={32} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No promos available right now.</p>
                  <p className="text-xs text-gray-400 mt-1">Xocks will publish promos here when available.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {promos.map((promo) => {
                    const eligibility = promoEligibility(promo)
                    return (
                      <button
                        key={promo.id}
                        onClick={() => selectPromo(promo)}
                        disabled={!eligibility.ok}
                        className={cn(
                          'w-full text-left rounded-xl p-3 border-2 transition-all',
                          eligibility.ok
                            ? 'bg-white border-amber-200 hover:border-amber-300 active:scale-[0.98]'
                            : 'bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Tag size={12} className="text-amber-600 shrink-0" />
                              <p className="text-sm font-bold text-[#0A0A0A] truncate">{promo.name}</p>
                            </div>
                            <p className="text-lg font-bold text-[#0A0A0A]">
                              {promo.discount_type === 'percentage'
                                ? `${Number(promo.discount_value)}% off`
                                : promo.discount_type === 'fixed'
                                  ? `${formatCurrency(Number(promo.discount_value))} off`
                                  : `Buy ${promo.buy_quantity} Free ${promo.free_quantity}`}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {promo.code && (
                                <span className="text-[10px] text-gray-500">
                                  Code: <span className="font-mono font-bold text-gray-700">{promo.code}</span>
                                </span>
                              )}
                              {promo.store_id === null && (
                                <span className="text-[9px] font-bold bg-[#FFD700]/30 text-[#0A0A0A] px-1.5 py-0.5 rounded-full">
                                  XOCKS PROMO
                                </span>
                              )}
                            </div>
                            {!eligibility.ok && (
                              <p className="text-[10px] text-red-500 mt-1 font-semibold">
                                {eligibility.reason}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
              <Link
                href="/store/promos"
                className="block mt-4 text-center text-xs text-gray-500 underline"
              >
                See all available promos →
              </Link>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
