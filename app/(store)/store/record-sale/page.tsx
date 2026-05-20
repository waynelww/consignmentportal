'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ScanLine, X, Minus, Plus, CheckCircle, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import QRCode from 'react-qr-code'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, generateRef, getStockStatus } from '@/lib/utils'
import type { StoreInventory, Profile, Store } from '@/types'
import { cn } from '@/lib/utils'

type Step = 'select' | 'quantity' | 'payment' | 'qr' | 'cash' | 'success'

interface QRPayload {
  store: string
  ref: string
  sku: string
  qty: number
  amount: number
  txn: string
  ts: number
}

export default function RecordSalePage() {
  const router = useRouter()

  const [storeData, setStoreData] = useState<{ store: Store | null; storeId: string | null }>({
    store: null,
    storeId: null,
  })
  const [inventory, setInventory] = useState<StoreInventory[]>([])
  const [loadingInventory, setLoadingInventory] = useState(true)

  const [step, setStep] = useState<Step>('select')
  const [selectedItem, setSelectedItem] = useState<StoreInventory | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [qrRef, setQrRef] = useState('')
  const [qrValue, setQrValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [scannerOpen, setScannerOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<any>(null)

  // Load store + inventory
  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('store_id')
        .eq('id', user.id)
        .single<Profile>()

      if (!profile?.store_id) { setLoadingInventory(false); return }

      const [storeRes, invRes] = await Promise.all([
        supabase.from('stores').select('*').eq('id', profile.store_id).single<Store>(),
        supabase
          .from('store_inventory')
          .select('*, product:products(*)')
          .eq('store_id', profile.store_id)
          .order('quantity_on_hand', { ascending: false }),
      ])

      setStoreData({ store: storeRes.data ?? null, storeId: profile.store_id })
      setInventory((invRes.data as StoreInventory[]) ?? [])
      setLoadingInventory(false)
    }
    load()
  }, [])

  // Barcode scanner
  const startScanner = useCallback(async () => {
    setScannerOpen(true)
    // Dynamically import to avoid SSR issues
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader

    try {
      await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result, err) => {
        if (result) {
          const barcode = result.getText()
          handleBarcodeResult(barcode)
        }
      })
    } catch {
      toast.error('Could not access camera. Please check permissions.')
      setScannerOpen(false)
    }
  }, [inventory]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopScanner = useCallback(() => {
    if (readerRef.current) {
      try { readerRef.current.reset() } catch {}
      readerRef.current = null
    }
    setScannerOpen(false)
  }, [])

  function handleBarcodeResult(barcode: string) {
    stopScanner()
    const match = inventory.find((i) => i.product?.barcode === barcode)
    if (match) {
      if (match.quantity_on_hand === 0) {
        toast.error('That product is out of stock.')
        return
      }
      selectProduct(match)
      toast.success(`${match.product?.name} selected`)
    } else {
      toast.error('Barcode not recognised. Please select manually.')
    }
  }

  function selectProduct(item: StoreInventory) {
    setSelectedItem(item)
    setQuantity(1)
    setStep('quantity')
  }

  function buildQRValue(txnRef: string): string {
    const store = storeData.store
    if (!store || !selectedItem) return ''
    const payload: QRPayload = {
      store: store.store_code,
      ref: store.qr_code_ref,
      sku: selectedItem.product?.sku ?? '',
      qty: quantity,
      amount: totalAmount,
      txn: txnRef,
      ts: Date.now(),
    }
    // TODO: Replace QR content with actual DuitNow merchant dynamic QR API call
    // when bank merchant credentials are available.
    return `https://pay.xocks.co/?d=${btoa(JSON.stringify(payload))}`
  }

  function handleSelectPayment(method: 'qr' | 'cash') {
    if (method === 'qr') {
      const ref = generateRef(8)
      setQrRef(ref)
      setQrValue(buildQRValue(ref))
      setStep('qr')
    } else {
      setStep('cash')
    }
  }

  const totalAmount = selectedItem ? selectedItem.product!.selling_price * quantity : 0

  async function recordSale(paymentMethod: 'qr' | 'cash') {
    if (!selectedItem || !storeData.storeId) return
    setSubmitting(true)

    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeData.storeId,
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
          <button
            onClick={startScanner}
            className="w-full h-14 rounded-xl border-2 border-dashed border-[#0A0A0A] flex items-center justify-center gap-2 font-semibold text-[#0A0A0A] hover:bg-gray-50 transition-colors"
          >
            <ScanLine size={20} />
            Scan Barcode
          </button>

          {loadingInventory ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {inventory.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No products in inventory.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {inventory.map((item) => {
                    const outOfStock = item.quantity_on_hand === 0
                    return (
                      <button
                        key={item.id}
                        disabled={outOfStock}
                        onClick={() => selectProduct(item)}
                        className={cn(
                          'relative bg-white rounded-xl shadow-sm p-3 text-left transition-all active:scale-95',
                          outOfStock ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md cursor-pointer',
                        )}
                      >
                        {outOfStock && (
                          <div className="absolute inset-0 bg-gray-100/70 rounded-xl flex items-center justify-center">
                            <span className="text-xs font-bold text-gray-400">Out of Stock</span>
                          </div>
                        )}
                        <p className="text-sm font-bold text-[#0A0A0A] leading-tight mb-1 line-clamp-2">
                          {item.product?.name}
                        </p>
                        <p className="text-xs text-gray-400">{item.product?.sku}</p>
                        <p className="text-sm font-semibold text-[#0A0A0A] mt-2">
                          {formatCurrency(item.product?.selling_price ?? 0)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Stock: {item.quantity_on_hand}</p>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
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
          <div className="bg-white rounded-xl shadow-sm p-6 flex flex-col items-center gap-4">
            <p className="text-sm text-gray-500 font-medium">Ask customer to scan this QR code</p>
            <div className="p-3 bg-white border border-gray-200 rounded-xl">
              <QRCode value={qrValue} size={200} />
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-[#0A0A0A]">{formatCurrency(totalAmount)}</p>
              <p className="text-xs text-gray-400 mt-1">
                {quantity} × {selectedItem.product?.name}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-2 w-full text-center">
              <p className="text-xs text-gray-400">Ref</p>
              <p className="font-mono font-bold text-[#0A0A0A] tracking-widest text-sm">{qrRef}</p>
            </div>
          </div>

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
            Cancel
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
