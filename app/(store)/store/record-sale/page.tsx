'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ScanLine, X, Minus, Plus, CheckCircle, Loader2, AlertTriangle, Search } from 'lucide-react'
import { toast } from 'sonner'
import QRCode from 'react-qr-code'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, generateRef, getStockStatus } from '@/lib/utils'
import type { StoreInventory } from '@/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/components/store/StoreContext'

type Step = 'select' | 'quantity' | 'payment' | 'qr' | 'cash' | 'success'


export default function RecordSalePage() {
  const router = useRouter()
  const { storeId, store } = useStore()

  const [inventory, setInventory] = useState<StoreInventory[]>([])
  const [loadingInventory, setLoadingInventory] = useState(true)

  const [step, setStep] = useState<Step>('select')
  const [selectedItem, setSelectedItem] = useState<StoreInventory | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [qrRef, setQrRef] = useState('')
  const [qrValue, setQrValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [search, setSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<any>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const hasScannedRef = useRef(false) // prevents duplicate toasts

  // Load inventory — storeId comes from StoreContext (no auth waterfall)
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

  // Only show in-stock items in the selector, filtered by search term
  const visibleInventory = useMemo(() => {
    const inStock = inventory.filter((i) => i.quantity_on_hand > 0)
    if (!search.trim()) return inStock
    const q = search.trim().toLowerCase()
    return inStock.filter((i) =>
      i.product?.name?.toLowerCase().includes(q) ||
      i.product?.sku?.toLowerCase().includes(q)
    )
  }, [inventory, search])

  // Barcode scanner — uses decodeFromConstraints (the correct @zxing/browser API)
  // which handles getUserMedia internally. Rear camera via facingMode: environment.
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
      // TRY_HARDER is for still images; in live video mode it causes false positives.
      // Keep it false to only fire on clear, unambiguous scans.
      hints.set(DecodeHintType.TRY_HARDER, false)

      const reader = new BrowserMultiFormatReader(hints)
      readerRef.current = reader

      // decodeFromConstraints handles getUserMedia + video srcObject internally.
      // Use { exact: 'environment' } on mobile, fall back with 'ideal' if denied.
      let videoConstraints: MediaTrackConstraints = { facingMode: { ideal: 'environment' } }
      try {
        // Probe for rear camera support before committing
        const devices = await navigator.mediaDevices.enumerateDevices()
        const hasRearCamera = devices.some(
          (d) => d.kind === 'videoinput' && /back|rear|environment/i.test(d.label)
        )
        if (hasRearCamera) {
          videoConstraints = { facingMode: { exact: 'environment' } }
        }
      } catch {
        // enumerateDevices not available — fall back to ideal
      }

      const controls = await reader.decodeFromConstraints(
        { video: videoConstraints },
        videoRef.current!,
        (result, err) => {
          // result is non-null only when a barcode was successfully decoded
          if (result && !hasScannedRef.current) {
            hasScannedRef.current = true
            handleBarcodeResult(result.getText())
          }
          // Ignore NotFoundException (no barcode in frame) — these are expected and noisy
        }
      )
      controlsRef.current = controls
    } catch {
      toast.error('Camera access denied — please allow camera access in your browser settings.')
      setScannerOpen(false)
    }
  }, [inventory]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopScanner = useCallback(() => {
    // Use the controls object returned by decodeFromConstraints to stop cleanly
    controlsRef.current?.stop()
    controlsRef.current = null
    // Also reset the reader instance
    if (readerRef.current) {
      try { readerRef.current.reset() } catch {}
      readerRef.current = null
    }
    // NOTE: do NOT reset hasScannedRef here.
    // It stays true so any stray callbacks that fire after stop() are still ignored.
    // It is only reset to false in startScanner() when a new scan session opens.
    setScannerOpen(false)
  }, [])

  function handleBarcodeResult(barcode: string) {
    // Stop scanner first — prevents any further callbacks firing
    stopScanner()

    const scanned = barcode.trim()

    // Match by barcode field, SKU (exact), or SKU (case-insensitive)
    // This handles both standard product barcodes AND custom SKU labels
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
      selectProduct(match)
      toast.success(`${match.product?.name} selected`)
    } else {
      // Single toast — hasScannedRef guard ensures this fires exactly once per scan session
      toast.error('Barcode not recognised. Please select manually.', { duration: 3000 })
    }
  }

  function selectProduct(item: StoreInventory) {
    setSelectedItem(item)
    setQuantity(1)
    setStep('quantity')
  }

  function handleSelectPayment(method: 'qr' | 'cash') {
    if (method === 'qr') {
      const ref = generateRef(8)
      setQrRef(ref)
      // Use store's own payment QR URL (DuitNow / TNG link set in store profile)
      const payUrl = store?.payment_qr_url
      setQrValue(payUrl ?? '')
      setStep('qr')
    } else {
      setStep('cash')
    }
  }

  const totalAmount = selectedItem ? selectedItem.product!.selling_price * quantity : 0

  async function recordSale(paymentMethod: 'qr' | 'cash') {
    if (!selectedItem || !storeId) return
    setSubmitting(true)

    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          product_id: selectedItem.product_id,
          quantity,
          payment_method: paymentMethod,
          qr_reference: paymentMethod === 'qr' ? qrRef : undefined,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? 'Failed to record sale')
      }

      const willRunOut = selectedItem.quantity_on_hand - quantity === 0

      setStep('success')
      setTimeout(() => {
        router.push('/store/dashboard')
        if (willRunOut) {
          toast.warning('Last unit sold! Stock is now 0. Consider requesting a restock.')
        }
      }, 2000)
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to record sale. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
          <CheckCircle size={40} className="text-[#22C55E]" />
        </div>
        <h2 className="text-2xl font-bold text-[#0A0A0A]">Sale Recorded!</h2>
        <p className="text-gray-500 mt-2">
          {quantity} × {selectedItem?.product?.name}
        </p>
        <p className="text-3xl font-bold text-[#0A0A0A] mt-3">{formatCurrency(totalAmount)}</p>
        <p className="text-sm text-gray-400 mt-4">Redirecting to dashboard…</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-bold text-[#0A0A0A]">Record a Sale</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {(['select', 'quantity', 'payment'] as const).map((s, i) => (
          <div
            key={s}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-all',
              (step === s || (step === 'qr' && i <= 2) || (step === 'cash' && i <= 2))
                ? 'bg-[#FFD700]'
                : i === 0
                ? 'bg-[#FFD700]'
                : 'bg-gray-200',
            )}
          />
        ))}
      </div>

      {/* ── Step 1: Select Product ── */}
      {step === 'select' && (
        <>
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

          {loadingInventory ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-40 bg-gray-200 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : visibleInventory.length === 0 ? (
            <p className="text-center text-gray-400 py-10">
              {search ? 'No products match your search.' : 'No products in stock.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {visibleInventory.map((item) => {
                const imgUrl = item.product?.image_url
                return (
                  <button
                    key={item.id}
                    onClick={() => selectProduct(item)}
                    className="relative bg-white rounded-xl shadow-sm text-left transition-all active:scale-95 hover:shadow-md cursor-pointer overflow-hidden"
                  >
                    {/* Product image or placeholder */}
                    <div className="w-full h-28 bg-gray-100 flex items-center justify-center overflow-hidden">
                      {imgUrl ? (
                        <Image
                          src={imgUrl}
                          alt={item.product?.name ?? ''}
                          width={160}
                          height={112}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <span className="text-3xl font-black text-gray-200 select-none">
                          {item.product?.sku?.slice(0, 3) ?? '?'}
                        </span>
                      )}
                    </div>
                    <div className="p-2.5">
                      <p className="text-xs font-bold text-[#0A0A0A] leading-tight line-clamp-2">
                        {item.product?.name}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{item.product?.sku}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <p className="text-xs font-semibold text-[#0A0A0A]">
                          {formatCurrency(item.product?.selling_price ?? 0)}
                        </p>
                        <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                          {item.quantity_on_hand} left
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Step 2: Quantity ── */}
      {step === 'quantity' && selectedItem && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <p className="text-base font-bold text-[#0A0A0A]">{selectedItem.product?.name}</p>
            <p className="text-sm text-gray-500 mt-0.5">{selectedItem.product?.sku}</p>
            <p className="text-2xl font-bold text-[#0A0A0A] mt-2">
              {formatCurrency(selectedItem.product?.selling_price ?? 0)}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <p className="text-sm font-medium text-gray-500 text-center mb-4">Quantity</p>
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors active:scale-95"
              >
                <Minus size={20} />
              </button>
              <span className="text-5xl font-bold text-[#0A0A0A] min-w-[3rem] text-center">
                {quantity}
              </span>
              <button
                onClick={() =>
                  setQuantity((q) => Math.min(selectedItem.quantity_on_hand, q + 1))
                }
                disabled={quantity >= selectedItem.quantity_on_hand}
                className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={20} />
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center mt-3">
              Max: {selectedItem.quantity_on_hand} in stock
            </p>
          </div>

          <div className="bg-[#0A0A0A] rounded-xl p-4 flex justify-between items-center">
            <span className="text-gray-400 text-sm">Total</span>
            <span className="text-[#FFD700] text-2xl font-bold">{formatCurrency(totalAmount)}</span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('select')}
              className="flex-1 h-14 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold"
            >
              Back
            </button>
            <button
              onClick={() => setStep('payment')}
              className="flex-2 flex-grow-[2] h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-semibold"
            >
              Select Payment
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Payment Method ── */}
      {step === 'payment' && selectedItem && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-4 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium text-[#0A0A0A]">
                {quantity} × {selectedItem.product?.name}
              </p>
            </div>
            <p className="text-lg font-bold text-[#0A0A0A]">{formatCurrency(totalAmount)}</p>
          </div>

          <p className="text-sm text-gray-500 text-center font-medium">Choose payment method</p>

          <button
            onClick={() => handleSelectPayment('qr')}
            className="w-full h-20 rounded-xl bg-teal-600 text-white font-bold text-lg flex flex-col items-center justify-center gap-1 shadow-sm hover:bg-teal-700 active:scale-95 transition-all"
          >
            <span>QR Payment</span>
            <span className="text-xs font-normal opacity-80">DuitNow / QR code</span>
          </button>

          <button
            onClick={() => handleSelectPayment('cash')}
            className="w-full h-20 rounded-xl bg-[#0A0A0A] text-white font-bold text-lg flex flex-col items-center justify-center gap-1 shadow-sm hover:opacity-90 active:scale-95 transition-all"
          >
            <span>Cash Payment</span>
            <span className="text-xs font-normal opacity-60">Collect cash from customer</span>
          </button>

          <button
            onClick={() => setStep('quantity')}
            className="w-full h-12 rounded-xl border-2 border-gray-200 text-gray-500 font-medium"
          >
            Back
          </button>
        </div>
      )}

      {/* ── Step 4a: QR Payment ── */}
      {step === 'qr' && selectedItem && (
        <div className="space-y-4">
          {!qrValue ? (
            /* No payment QR set up yet */
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center space-y-3">
              <AlertTriangle size={28} className="text-amber-500 mx-auto" />
              <p className="text-sm font-semibold text-amber-800">Payment QR not set up</p>
              <p className="text-xs text-amber-700">
                Go to your Profile and paste your DuitNow / TNG / bank payment link to enable QR payments.
              </p>
              <a
                href="/store/profile"
                className="inline-block mt-1 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold"
              >
                Set up now
              </a>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-6 flex flex-col items-center gap-4">
              {/* Amount banner — customer enters this amount when paying */}
              <div className="w-full bg-[#0A0A0A] rounded-xl py-3 text-center">
                <p className="text-xs text-gray-400 mb-0.5">Amount to pay</p>
                <p className="text-3xl font-bold text-[#FFD700]">{formatCurrency(totalAmount)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{quantity} × {selectedItem.product?.name}</p>
              </div>
              <p className="text-sm text-gray-500 font-medium">Ask customer to scan this code</p>
              <div className="p-3 bg-white border border-gray-200 rounded-xl shadow-sm">
                <QRCode value={qrValue} size={220} />
              </div>
              <p className="text-xs text-gray-400 text-center">
                Works with DuitNow, TNG, Boost, MAE, and all Malaysian banking apps
              </p>
              <div className="bg-gray-50 rounded-lg px-4 py-2 w-full text-center">
                <p className="text-[10px] text-gray-400">Transaction ref</p>
                <p className="font-mono font-bold text-[#0A0A0A] tracking-widest text-sm">{qrRef}</p>
              </div>
            </div>
          )}

          <button
            onClick={() => recordSale('qr')}
            disabled={submitting}
            className={cn(
              'w-full h-14 rounded-xl bg-[#22C55E] text-white font-bold text-base flex items-center justify-center gap-2',
              submitting ? 'opacity-60 cursor-not-allowed' : 'hover:bg-green-600 active:scale-95 transition-all',
            )}
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
            Payment Received ✓
          </button>

          <button
            onClick={() => setStep('payment')}
            disabled={submitting}
            className="w-full h-12 rounded-xl border-2 border-gray-200 text-gray-500 font-medium"
          >
            Back
          </button>
        </div>
      )}

      {/* ── Step 4b: Cash Payment ── */}
      {step === 'cash' && selectedItem && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-6 text-center space-y-3">
            <p className="text-sm text-gray-500">Collect from customer</p>
            <p className="text-4xl font-bold text-[#0A0A0A]">{formatCurrency(totalAmount)}</p>
            <p className="text-sm text-gray-400">
              {quantity} × {selectedItem.product?.name}
            </p>
          </div>

          <button
            onClick={() => recordSale('cash')}
            disabled={submitting}
            className={cn(
              'w-full h-14 rounded-xl bg-[#22C55E] text-white font-bold text-base flex items-center justify-center gap-2',
              submitting ? 'opacity-60 cursor-not-allowed' : 'hover:bg-green-600 active:scale-95 transition-all',
            )}
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
            Record Cash Sale ✓
          </button>

          <button
            onClick={() => setStep('payment')}
            disabled={submitting}
            className="w-full h-12 rounded-xl border-2 border-gray-200 text-gray-500 font-medium"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Camera barcode modal ── */}
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
            {/* Viewfinder overlay */}
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
