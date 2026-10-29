'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Check, ChevronDown, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import type { StoreStaff } from '@/types'
import { cn } from '@/lib/utils'
import {
  getSelectedStaffId,
  setSelectedStaffId,
  subscribeSelectedStaff,
} from '@/lib/store-staff/selection'

export interface StoreStaffState {
  staff: StoreStaff[]
  loaded: boolean
  loading: boolean
  add: (name: string) => Promise<StoreStaff | null>
  update: (id: string, patch: { name?: string; active?: boolean }) => Promise<StoreStaff | null>
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** The staff id picked on this phone for the store (null when none). */
export function useSelectedStaffId(storeId: string | null): string | null {
  return useSyncExternalStore(
    subscribeSelectedStaff,
    () => (storeId ? getSelectedStaffId(storeId) : null),
    () => null,
  )
}

/**
 * Loads a store's staff and exposes add/update. Store app: active names only,
 * and a remembered pick that is no longer on the list is forgotten.
 * Admin: pass includeHidden to see and restore hidden names too.
 */
export function useStoreStaff(
  storeId: string | null,
  { includeHidden = false }: { includeHidden?: boolean } = {},
): StoreStaffState {
  const [staff, setStaff] = useState<StoreStaff[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/store-staff?store_id=${storeId}${includeHidden ? '&include_hidden=1' : ''}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not load staff')
      const list = (body.staff ?? []) as StoreStaff[]
      setStaff(list)
      setLoaded(true)
      if (!includeHidden) {
        const selected = getSelectedStaffId(storeId)
        if (selected && !list.some((s) => s.id === selected)) setSelectedStaffId(storeId, null)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load staff')
    } finally {
      setLoading(false)
    }
  }, [storeId, includeHidden])

  useEffect(() => {
    reload()
  }, [reload])

  const add = useCallback(async (name: string) => {
    if (!storeId) return null
    const res = await fetch('/api/store-staff', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ store_id: storeId, name }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(body.error ?? 'Could not add staff')
      return null
    }
    await reload()
    return body.staff as StoreStaff
  }, [storeId, reload])

  const update = useCallback(async (id: string, patch: { name?: string; active?: boolean }) => {
    const res = await fetch(`/api/store-staff/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(body.error ?? 'Could not update staff')
      return null
    }
    await reload()
    return body.staff as StoreStaff
  }, [reload])

  return { staff, loaded, loading, add, update }
}

/**
 * Staff list with "+ Add staff" at the top, plus rename and remove per name.
 * Tapping a name selects it on this phone and calls onPicked.
 */
export function StaffPanel({
  storeId,
  selectedId,
  state,
  onPicked,
}: {
  storeId: string
  selectedId: string | null
  state: StoreStaffState
  onPicked?: (member: StoreStaff) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  function pick(member: StoreStaff) {
    setSelectedStaffId(storeId, member.id)
    onPicked?.(member)
  }

  async function saveNew() {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    const created = await state.add(name)
    setSaving(false)
    if (created) {
      setNewName('')
      setAdding(false)
      pick(created)
    }
  }

  async function saveRename(member: StoreStaff) {
    const name = editName.trim()
    if (!name || saving) return
    if (name === member.name) {
      setEditingId(null)
      return
    }
    setSaving(true)
    const updated = await state.update(member.id, { name })
    setSaving(false)
    if (updated) setEditingId(null)
  }

  async function hide(member: StoreStaff) {
    if (!window.confirm(`Remove ${member.name} from the staff list? Past sales keep their name.`)) return
    await state.update(member.id, { active: false })
  }

  return (
    <div className="flex flex-col min-h-0">
      <button
        type="button"
        onClick={() => setAdding((v) => !v)}
        className="flex items-center h-12 px-4 text-sm font-bold text-[#0A0A0A] border-b border-gray-100 hover:bg-gray-50 shrink-0"
      >
        + Add staff
      </button>

      {adding && (
        <div className="flex gap-2 p-3 border-b border-gray-100 bg-gray-50 shrink-0">
          <input
            type="text"
            autoFocus
            maxLength={60}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveNew() }}
            placeholder="Staff name"
            className="flex-1 min-w-0 h-11 px-3 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          />
          <button
            type="button"
            onClick={saveNew}
            disabled={!newName.trim() || saving}
            className="px-4 h-11 rounded-lg bg-[#0A0A0A] text-[#FFD700] text-sm font-bold disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}

      <div className="overflow-y-auto">
        {!state.loaded && state.loading ? (
          <p className="text-center text-sm text-gray-400 py-8">Loading…</p>
        ) : state.staff.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8 px-4">No staff yet. Add the first name above.</p>
        ) : (
          state.staff.map((member) => {
            if (editingId === member.id) {
              return (
                <div key={member.id} className="flex gap-2 p-3 border-b border-gray-100 bg-gray-50">
                  <input
                    type="text"
                    autoFocus
                    maxLength={60}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(member) }}
                    className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                  <button
                    type="button"
                    onClick={() => saveRename(member)}
                    disabled={!editName.trim() || saving}
                    className="px-3 h-10 rounded-lg bg-[#0A0A0A] text-[#FFD700] text-xs font-bold disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center"
                    aria-label="Cancel rename"
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            }

            const isSelected = member.id === selectedId
            return (
              <div key={member.id} className="flex items-center gap-1 pr-2 border-b border-gray-100">
                <button
                  type="button"
                  onClick={() => pick(member)}
                  className={cn(
                    'flex-1 min-w-0 flex items-center gap-3 h-12 px-4 text-left text-sm',
                    isSelected ? 'font-bold text-[#0A0A0A]' : 'text-gray-700',
                  )}
                >
                  <span className="w-4 shrink-0">
                    {isSelected && <Check size={16} className="text-[#22C55E]" />}
                  </span>
                  <span className="truncate">{member.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingId(member.id); setEditName(member.name) }}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100"
                  aria-label={`Rename ${member.name}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => hide(member)}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                  aria-label={`Remove ${member.name}`}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/**
 * Header control on the store home screen: shows the selected staff name
 * ("Select staff" when none) and opens the staff list.
 */
export function StaffPicker({ storeId }: { storeId: string | null }) {
  const pathname = usePathname()
  if (!storeId || pathname !== '/store/dashboard') return null
  return <StaffPickerDropdown storeId={storeId} />
}

function StaffPickerDropdown({ storeId }: { storeId: string }) {
  const selectedId = useSelectedStaffId(storeId)
  const state = useStoreStaff(storeId)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = state.staff.find((s) => s.id === selectedId) ?? null

  // Close when tapping anywhere outside the picker
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div ref={rootRef} className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1 h-8 max-w-[140px] px-2.5 rounded-lg text-xs font-semibold',
          selected ? 'bg-white/10 text-white' : 'bg-[#FFD700] text-[#0A0A0A]',
        )}
      >
        <span className="truncate">{selected?.name ?? 'Select staff'}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>

      {open && (
        <div className="fixed inset-x-4 top-[68px] z-[80] bg-white text-[#0A0A0A] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[60vh]">
          <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 shrink-0">
            Who is keying in sales?
          </div>
          <StaffPanel
            storeId={storeId}
            selectedId={selectedId}
            state={state}
            onPicked={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

/** Bottom sheet used by Record a Sale when no staff member is selected. */
export function StaffSheet({
  storeId,
  state,
  open,
  onClose,
  onPicked,
}: {
  storeId: string | null
  state: StoreStaffState
  open: boolean
  onClose: () => void
  onPicked: (member: StoreStaff) => void
}) {
  const selectedId = useSelectedStaffId(storeId)
  if (!open || !storeId) return null
  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl max-h-[75vh] flex flex-col shadow-2xl mb-[72px]">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#0A0A0A]">Who is selling?</h2>
            <p className="text-xs text-gray-400">Pick the staff member keying in this sale</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <StaffPanel storeId={storeId} selectedId={selectedId} state={state} onPicked={onPicked} />
      </div>
    </div>
  )
}
