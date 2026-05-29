'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, AlertTriangle, Loader2, Package } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { StoreInventory } from '@/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/components/store/StoreContext'

interface RequestItem {
  inventoryItem: StoreInventory
  included: boolean
  requestQty: number
}

type PageStep = 'review' | 'success'

export default function RestockRequestPage() {
  const { storeId } = useStore()
  const [items, setItems] = useState<RequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState<PageStep>('review')

  useEffect(() => {
    if (!storeId) return
    async function load() {
      const supabase = createClient()

      // storeId from context — no auth waterfall needed
      const { data: invData } = await supabase
        .from('store_inventory')
        .select('*, product:products(*)')
        .eq('store_id', storeId!)
        .order('quantity_on_hand', { ascending: true })

      const inv = (invData as StoreInventory[]) ?? []

      const requestItems: RequestItem[] = inv.map((item) => {
        const belowThreshold = item.quantity_on_hand < item.restock_threshold
        // Default: target is 24 pairs, minimum request
        const defaultQty = Math.max(0, 24 - item.quantity_on_hand)
        return {
          inventoryItem: item,
          included: belowThreshold,
          requestQty: defaultQty > 0 ? defaultQty : 12,
        }
      })

      setItems(requestItems)
      setLoading(false)
    }
    load()
  }, [storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const includedItems = items.filter((i) => i.included)
  const totalRequested = includedItems.reduce((s, i) => s + i.requestQty, 0)
  const belowMinimum = includedItems.length > 0 && totalRequested < 12

  function toggleItem(productId: string) {
    setItems((prev) =>
      prev.map((i) =>
        i.inventoryItem.product_id === productId
          ? { ...i, included: !i.included }
          : i,
      ),
    )
  }

  function updateQty(productId: string, qty: number) {
    setItems((prev) =>
      prev.map((i) =>
        i.inventoryItem.product_id === productId
          ? { ...i, requestQty: Math.max(1, qty) }
          : i,
      ),
    )
  }

  async function handleSubmit() {
    if (!storeId) return

    if (includedItems.length === 0) {
      toast.error('Select at least one product to request.')
      return
    }

    if (belowMinimum) {
      toast.error('Minimum restock is 12 pairs. Please increase quantities.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/restock/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          items: includedItems.map((i) => ({
            product_id: i.inventoryItem.product_id,
            quantity_requested: i.requestQty,
          })),
          notes: notes.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? 'Failed to submit request')
      }

      setStep('success')
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to submit restock request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'success') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
          <CheckCircle size={40} className="text-[#22C55E]" />
        </div>
        <h2 className="text-2xl font-bold text-[#0A0A0A]">Request Submitted!</h2>
        <p className="text-gray-500 mt-2 max-w-xs">
          Wayne's team will review and process your restock request soon.
        </p>
        <p className="text-sm text-gray-400 mt-2">{totalRequested} pairs requested</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-bold text-[#0A0A0A]">Request Restock</h1>
      <p className="text-sm text-gray-500">
        Items below threshold are pre-selected. Adjust quantities as needed.
      </p>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-2/5 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package size={40} className="text-gray-300 mb-3" />
          <p className="text-gray-400">No inventory items found.</p>
        </div>
      ) : (
        <>
          {/* Below minimum warning */}
          {belowMinimum && includedItems.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800">
                Minimum restock is 12 pairs. Current total: {totalRequested} pairs.
              </p>
            </div>
          )}

          {/* Items list */}
          <div className="space-y-3">
            {items.map((item) => {
              const inv = item.inventoryItem
              const belowThresh = inv.quantity_on_hand < inv.restock_threshold
              return (
                <div
                  key={inv.product_id}
                  className={cn(
                    'bg-white rounded-xl shadow-sm p-4 border-2 transition-all',
                    item.included ? 'border-[#FFD700]' : 'border-transparent',
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleItem(inv.product_id)}
                      className={cn(
                        'w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center shrink-0 transition-all',
                        item.included
                          ? 'bg-[#FFD700] border-[#FFD700]'
                          : 'bg-white border-gray-300',
                      )}
                    >
                      {item.included && (
                        <svg className="w-3 h-3 text-[#0A0A0A]" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-[#0A0A0A]">{inv.product?.name}</p>
                        {belowThresh && (
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            Low Stock
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {inv.product?.sku} · In stock: <strong className="text-gray-600">{inv.quantity_on_hand}</strong> · Threshold: {inv.restock_threshold}
                      </p>
                    </div>
                  </div>

                  {/* Quantity input — only when included */}
                  {item.included && (
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-xs text-gray-500 font-medium shrink-0">Request qty:</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQty(inv.product_id, item.requestQty - 1)}
                          className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-lg font-bold hover:bg-gray-200 transition-colors"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={item.requestQty}
                          onChange={(e) => updateQty(inv.product_id, parseInt(e.target.value) || 1)}
                          className="w-16 h-8 text-center border border-gray-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                        />
                        <button
                          onClick={() => updateQty(inv.product_id, item.requestQty + 1)}
                          className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-lg font-bold hover:bg-gray-200 transition-colors"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-xs text-gray-400">pairs</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Note for ops team <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any special requests or urgency notes…"
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-[#0A0A0A] resize-none focus:outline-none focus:ring-2 focus:ring-[#FFD700] placeholder:text-gray-400"
            />
          </div>

          {/* Summary + submit */}
          <div className="space-y-3 pb-4">
            {includedItems.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-3 flex justify-between items-center">
                <span className="text-sm text-gray-600">{includedItems.length} product{includedItems.length !== 1 ? 's' : ''} selected</span>
                <span className="text-sm font-bold text-[#0A0A0A]">{totalRequested} pairs total</span>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || includedItems.length === 0 || belowMinimum}
              className={cn(
                'w-full h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-bold text-base flex items-center justify-center gap-2',
                (submitting || includedItems.length === 0 || belowMinimum)
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:opacity-90 active:scale-95 transition-all',
              )}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Submitting…
                </>
              ) : (
                'Submit Restock Request'
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
