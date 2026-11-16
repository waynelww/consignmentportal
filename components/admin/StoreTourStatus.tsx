'use client'

/**
 * Read-only: the store owner's guided-tour status, shown on the store Overview.
 * Reads the owner's profile through the admin's own session (RLS lets admins
 * select profiles). Never writes.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { describeTourStatus } from '@/lib/tour/logic'
import { formatMYDate } from '@/lib/utils'
import type { TourStatus } from '@/types'

interface TourRow {
  tour_status: TourStatus | null
  tour_step: number | null
  tour_completed_at: string | null
}

export default function StoreTourStatus({ storeId }: { storeId: string }) {
  const [state, setState] = useState<{ loading: boolean; row: TourRow | null; error: boolean }>({
    loading: true,
    row: null,
    error: false,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await createClient()
          .from('profiles')
          .select('tour_status, tour_step, tour_completed_at')
          .eq('store_id', storeId)
          .eq('role', 'store_owner')
          .maybeSingle()
        if (cancelled) return
        if (error) throw error
        setState({ loading: false, row: (data as TourRow | null) ?? null, error: false })
      } catch {
        if (!cancelled) setState({ loading: false, row: null, error: true })
      }
    })()
    return () => { cancelled = true }
  }, [storeId])

  return (
    <div className="bg-gray-50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Owner tour</h3>
      {state.loading ? (
        <div className="h-6 bg-gray-200 animate-pulse rounded" />
      ) : state.error ? (
        <p className="text-sm text-gray-500">Tour status unavailable</p>
      ) : !state.row ? (
        <p className="text-sm text-gray-500">No store owner login found</p>
      ) : (
        <p className="text-sm text-gray-800 font-medium">
          {describeTourStatus(
            state.row.tour_status,
            state.row.tour_step,
            state.row.tour_completed_at,
            formatMYDate,
          )}
        </p>
      )}
    </div>
  )
}
