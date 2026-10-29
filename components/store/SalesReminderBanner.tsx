'use client'

// Pop-up shown in the store app when the store has not entered a sale for the
// reminder threshold (Settings → sales_reminder_days, default 7 days).
//
// It lives in the store layout, so it appears on each full open of XCMS. Closing
// it hides it for this visit only (plain state, nothing stored). Moving between
// pages re-checks the last sale, so a sale recorded during the visit clears it.
// In-app only: no WhatsApp, email or push, and no consequences.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchLastSaleDates, loadSalesReminderDays, storeSaleAge } from '@/lib/sales/last-sale'
import { useStore } from '@/components/store/StoreContext'

const RECORD_SALE_PATH = '/store/record-sale'

export default function SalesReminderBanner() {
  const { storeId, store } = useStore()
  const pathname = usePathname()
  const [days, setDays] = useState<number | null>(null)
  const [closed, setClosed] = useState(false)
  const createdAt = store?.created_at

  useEffect(() => {
    if (!storeId || closed) return
    let cancelled = false
    ;(async () => {
      try {
        const db = createClient()
        const [threshold, lastSaleMap] = await Promise.all([
          loadSalesReminderDays(db),
          fetchLastSaleDates(db, [storeId]),
        ])
        const age = storeSaleAge(lastSaleMap.get(storeId) ?? null, createdAt)
        if (!cancelled) setDays(age && age.days >= threshold ? age.days : null)
      } catch {
        // The reminder is optional; if the check fails, show nothing.
        if (!cancelled) setDays(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [storeId, createdAt, pathname, closed])

  if (closed || days === null || pathname === RECORD_SALE_PATH) return null

  const dayCount = days === 1 ? '1 day' : `${days} days`

  return (
    <div
      role="dialog"
      aria-label="Sales reminder"
      className="fixed top-[68px] left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md bg-white rounded-xl shadow-xl border border-amber-300 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900">
            {`You haven't recorded any sales for ${dayCount}. Please key in your sales so we can restock you on time.`}
          </p>
          <Link
            href={RECORD_SALE_PATH}
            className="inline-block mt-3 px-4 py-2 rounded-lg bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold"
          >
            Record a sale
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setClosed(true)}
          aria-label="Close"
          className="p-1 -mt-1 -mr-1 text-gray-400 hover:text-gray-700 rounded-md"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
