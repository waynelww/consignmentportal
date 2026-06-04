'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Tag, Percent, DollarSign, Gift } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, cn } from '@/lib/utils'
import type { Promo } from '@/types'
import { useStore } from '@/components/store/StoreContext'

export default function PromosPage() {
  const { storeId } = useStore()
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)

  const loadPromos = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/promos?store_id=${storeId}`)
      const data = await res.json()
      // Only show active promos (read-only view)
      setPromos((data.promos ?? []).filter((p: Promo) => p.is_active))
    } catch {
      toast.error('Failed to load promos')
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => { loadPromos() }, [loadPromos])

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4 pb-8">
      {/* Header */}
      <Link href="/store/dashboard" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft size={16} />
        Back
      </Link>

      <div>
        <h1 className="text-xl font-bold text-[#0A0A0A]">Available Promos</h1>
        <p className="text-xs text-gray-500 mt-1">
          Promos from Xocks that you can apply at checkout. Open the cart in Sales → Apply Promo to use one.
        </p>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : promos.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center">
          <Tag size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No promos available right now.</p>
          <p className="text-xs text-gray-400 mt-1">Xocks will publish new promos here when available.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {promos.map((promo) => (
            <div key={promo.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                  promo.discount_type === 'percentage' && 'bg-amber-100 text-amber-700',
                  promo.discount_type === 'fixed' && 'bg-green-100 text-green-700',
                  promo.discount_type === 'bxgy' && 'bg-purple-100 text-purple-700',
                )}>
                  {promo.discount_type === 'percentage' && <Percent size={18} />}
                  {promo.discount_type === 'fixed' && <DollarSign size={18} />}
                  {promo.discount_type === 'bxgy' && <Gift size={18} />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#0A0A0A] truncate">{promo.name}</p>
                  <p className="text-xl font-bold text-[#0A0A0A] mt-0.5">
                    {promo.discount_type === 'percentage'
                      ? `${Number(promo.discount_value)}% off`
                      : promo.discount_type === 'fixed'
                        ? `${formatCurrency(Number(promo.discount_value))} off`
                        : `Buy ${promo.buy_quantity} Free ${promo.free_quantity}`}
                  </p>
                  <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                    {promo.code && (
                      <p>
                        Code: <span className="font-mono font-bold text-gray-700">{promo.code}</span>
                      </p>
                    )}
                    {promo.min_quantity > 0 && (
                      <p>Minimum {promo.min_quantity} pair{promo.min_quantity !== 1 ? 's' : ''}</p>
                    )}
                    {Number(promo.min_amount) > 0 && (
                      <p>Minimum spend {formatCurrency(Number(promo.min_amount))}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer CTA */}
      {promos.length > 0 && (
        <Link
          href="/store/record-sale"
          className="block w-full h-12 bg-[#0A0A0A] text-[#FFD700] rounded-xl font-semibold text-sm text-center leading-[48px] mt-2"
        >
          Go to Sales →
        </Link>
      )}
    </div>
  )
}
