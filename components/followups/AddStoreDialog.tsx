'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X } from 'lucide-react'
import { callOnboardingApi } from '@/components/onboarding/api'

/** Adds a store that is not in XCMS. It stays on every month's checklist until hidden. */
export function AddStoreDialog({
  workingAs,
  onClose,
  onAdded,
}: {
  workingAs: string
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [picName, setPicName] = useState('')
  const [picPhone, setPicPhone] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!workingAs) { toast.error('Pick who you are under "Working as" first'); return }
    setBusy(true)
    try {
      await callOnboardingApi('/api/followups/extra-stores', 'POST', {
        name: name.trim(),
        pic_name: picName.trim() || null,
        pic_phone: picPhone.trim() || null,
        by_member_id: workingAs,
      })
      toast.success('Store added to the checklist')
      await onAdded()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add store')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Add a store that is not in XCMS</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
        </div>
        <label className="block text-sm">
          <span className="text-gray-600">Store name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">PIC name (optional)</span>
          <input value={picName} onChange={(e) => setPicName(e.target.value)} maxLength={120}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">PIC phone (optional)</span>
          <input value={picPhone} onChange={(e) => setPicPhone(e.target.value)} maxLength={30}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[#0A0A0A] text-[#FFD700] disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add store
          </button>
        </div>
      </form>
    </div>
  )
}
