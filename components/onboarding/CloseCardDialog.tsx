'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { CLOSE_REASONS, type CloseReason } from '@/lib/onboarding/steps'
import { callOnboardingApi } from '@/components/onboarding/api'
import type { OnboardingCardRow } from '@/types'

interface CloseCardDialogProps {
  card: OnboardingCardRow
  /** Name of the "Working as" team member; the close is recorded against them. */
  closingAsName: string | null
  workingAs: string
  onClose: () => void
  onDone: () => Promise<void>
}

/**
 * "Remove store (deal rejected)": takes the card off the board. Asks for a
 * reason, an optional note, and (when a store is linked) whether to also set the
 * store inactive. Nothing is deleted.
 */
export function CloseCardDialog({ card, closingAsName, workingAs, onClose, onDone }: CloseCardDialogProps) {
  const [reason, setReason] = useState<CloseReason>('deal_rejected')
  const [note, setNote] = useState('')
  const [setInactive, setSetInactive] = useState(false)
  const [saving, setSaving] = useState(false)
  const input = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#FFD700]'

  async function submit() {
    if (!workingAs) { toast.error('Pick who you are at the top of the board first'); return }
    setSaving(true)
    try {
      await callOnboardingApi(`/api/onboarding/cards/${card.id}/close`, 'POST', {
        by_member_id: workingAs,
        reason,
        note,
        set_store_inactive: card.store_id ? setInactive : undefined,
      })
      toast.success(`${card.store_name} removed from the board`)
      await onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the store')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Remove store (deal rejected)</h2>
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">{card.store_name}</span> leaves the board. Nothing is deleted.
          You can reopen it from the Closed list, and it goes back to the step it was on.
        </p>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
          <select value={reason} onChange={(e) => setReason(e.target.value as CloseReason)} className={input}>
            {CLOSE_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        </div>

        {card.store_id && card.store && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5" checked={setInactive} onChange={(e) => setSetInactive(e.target.checked)} />
            <span>
              Also set {card.store.store_code} · {card.store.store_name} to inactive
              <span className="block text-xs text-gray-500">The store record is kept. Only its status changes.</span>
            </span>
          </label>
        )}

        <p className="text-xs text-gray-600">
          {closingAsName ? <>Removing as <span className="font-medium">{closingAsName}</span>.</> : 'Pick who you are at the top of the board first.'}
        </p>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-200">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !workingAs}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Remove from board
          </button>
        </div>
      </div>
    </div>
  )
}
