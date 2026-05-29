'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { ScanLine, X, ShoppingCart, CheckCircle, Loader2, Search, Minus, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import type { StoreInventory } from '@/types'
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
  const [successInfo, setSuccessInfo] = useState<{ pairs: number; total: number } | null>(null)

  const [search, setSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<any>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const hasScannedRef = useRef(false)

  // Load inventory — storeId from StoreContext, no auth waterfall
  useEffect(() => {
    if (!storeId) return
    async function load() {
      const supabase = createClient()
      const { data: invData } = await supabase
        .from('store_inventory')
        .select('*, product:products(*)')
        .eq('store_id', storeId!)
        .order('quantity_on_hand', { ascending: false })
      setInventory((invData as StoreInventory[]) ?? [])
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
  const cartTotal = cart.reduce((s, c) => s + (c.inventoryItem.product?.selling_price ?? 0) * c.quantity, 0)

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

  // Barcode scanner
  const startScanner = useCallback(async () => {
    hasScannedRef.current = false
    setScannerOpen(true)

    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')

      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.UPC_A,
        BarcodeFormat.QR_CODE,
      ])
      hints.set(DecodeHintType.TRY_HARDER, false)

      const reader = new BrowserMultiFormatReader(hints)
      readerRef.current = reader

      let videoConstraints: MediaTrackConstraints = { facingMode: { ideal: 'environment' } }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const hasRearCamera = devices.some(
          (d) => d.kind === 'videoinput' && /back|rear|environment/i.test(d.label)
        )
        if (hasRearCamera) {
          videoConstraints = { facingMode: { exact: 'environment' } }
        }
      } catch { /* fall back */ }

      const controls = await reader.decodeFromConstraints(
        { video: videoConstraints },
        videoRef.current!,
        (result) => {
          if (result && !hasScannedRef.current) {
            hasScannedRef.current = true
            handleBarcodeResult(result.getText())
          }
        }
      )
      controlsRef.current = controls
    } catch {
      toast.error('Camera access denied — please allow camera access in your browser settings.')
      setScannerOpen(false)
    }
  }, [inventory]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    if (readerRef.current) {
      try { readerRef.current.reset() } catch {}
      readerRef.current = null
    }
    setScannerOpen(false)
  }, [])

  function handleBarcodeResult(barcode: string) {
    stopScanner()
    const scanned = barcode.trim()
    const match = inventory.find((i) => {
      const p = i.product
      if (!p) return false
      if (p.barcode && p.barcode === scanned) return true
      if (p.sku && p.sku === scanned) return true
      if (p.sku && p.sku.toLowerCase() === scanned.toLowerCase()) return true
      return false
    })

    if (match) {
      if (match.quantity_on_hand === 0) {
        toast.error(`${match.product?.name ?? 'Product'} is out of stock.`)
        return
      }
      addToCart(match)
      toast.success(`${match.product?.name} added to cart`)
    } else {
      toast.error('Barcode not recognised. Please select manually.', { duration: 3000 })
    }
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
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? 'Failed to record sale')
      }

      const data = await res.json()
      setSuccessInfo({ pairs: data.total_pairs, total: data.grand_total })
      setCartOpen(false)
      setCart([])
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

      {/* Scan + search row */}
      <div className="flex gap-2">
        <button
          onClick={startScanner}
          className="h-12 px-4 rounded-xl border-2 border-dashed border-[#0A0A0A] flex items-center gap-2 font-semibold text-[#0A0A0A] hover:bg-gray-50 transition-colors shrink-0"
        >
          <ScanLine size={18} />
          Scan
        </button>
        <div className="relative flex-1">
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

            {/* Footer */}
            <div className="px-4 pt-3 pb-6 border-t border-gray-100 space-y-3 shrink-0">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">{cartCount} pair{cartCount !== 1 ? 's' : ''}</span>
                <span className="text-lg font-bold text-[#0A0A0A]">{formatCurrency(cartTotal)}</span>
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

      {/* Camera barcode modal */}
      {scannerOpen && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 pt-safe-top py-3">
            <span className="text-white font-semibold text-base">Scan Barcode</span>
            <button onClick={stopScanner} className="text-white p-1">
              <X size={24} />
            </button>
          </div>

          <div className="flex-1 relative flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              autoPlay
              muted
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-40 border-2 border-[#FFD700] rounded-xl" />
            </div>
          </div>

          <div className="px-4 pb-8 pt-3 text-center">
            <p className="text-gray-400 text-sm">Point camera at barcode</p>
            <button
              onClick={stopScanner}
              className="mt-3 w-full h-12 rounded-xl border border-white/30 text-white font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
