'use client'

import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { HqStatus } from '@/lib/stock/hq-availability'
import type { ColourSuggestion } from '@/lib/stock/colour-suggestions'
import { cn, formatMYTime } from '@/lib/utils'

// Warnings only: nothing here blocks an action.

/** Red "Out at HQ" for 0, amber "Only X at HQ" when short, nothing when ok. */
export function HqAvailabilityBadge({ status, hqQty }: { status: HqStatus; hqQty: number | null }) {
  if (status === 'out') {
    return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-red-100 text-red-700">Out at HQ</span>
  }
  if (status === 'short') {
    return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-amber-100 text-amber-700">Only {hqQty ?? 0} at HQ</span>
  }
  return null
}

/** Row tint for a flagged line. */
export function hqRowClass(status: HqStatus): string {
  if (status === 'out') return 'bg-red-50'
  if (status === 'short') return 'bg-amber-50'
  return ''
}

/** Small HQ quantity cell: the number, or "—" when never synced. */
export function HqQtyCell({ qty, status }: { qty: number | null; status: HqStatus }) {
  return (
    <span className={cn('tabular-nums text-xs font-semibold', status === 'out' ? 'text-red-700' : status === 'short' ? 'text-amber-700' : 'text-gray-600')}>
      {qty ?? '—'}
    </span>
  )
}

/** Line under a page header: when Office (HQ) stock was last pulled, plus the admin refresh button. */
export function HqRefreshBar({ syncedAt, onRefreshed }: { syncedAt: string | null; onRefreshed: () => void }) {
  const [busy, setBusy] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const shown = lastSynced ?? syncedAt

  async function refresh() {
    setBusy(true)
    try {
      const res = await fetch('/api/products/sync-shopify-inventory', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || `Refresh failed (${res.status})`)
        return
      }
      setLastSynced(data.synced_at)
      toast.success(`Shopify stock updated ${formatMYTime(data.synced_at)}`)
      onRefreshed()
    } catch {
      toast.error('Refresh failed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
      <span>
        {shown ? <>Shopify stock updated <strong className="text-gray-700">{formatMYTime(shown)}</strong></> : 'Shopify stock not synced yet'}
        <span className="text-gray-400"> · Office (HQ) location</span>
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#E5E7EB] bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Refresh from Shopify
      </button>
    </div>
  )
}

/**
 * "Similar: A18 Grey Black (12 at HQ) · A38 Classic Blue (7 at HQ)" with a Swap
 * button per suggestion when `onSwap` is given. Swap is never automatic.
 */
export function SimilarColours({ suggestions, onSwap }: {
  suggestions: ColourSuggestion[]
  onSwap?: (s: ColourSuggestion) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-600">
      <span className="font-semibold text-gray-500">Similar:</span>
      {suggestions.map((s, i) => (
        <span key={s.sku} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-gray-300">·</span>}
          <span>{s.sku} {s.name} <span className="text-gray-400">({s.hqQty} at HQ)</span></span>
          {onSwap && (
            <button
              type="button"
              onClick={() => onSwap(s)}
              className="px-1.5 py-0.5 rounded border border-[#E5E7EB] bg-white text-gray-700 font-semibold hover:bg-gray-50"
            >
              Swap
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
