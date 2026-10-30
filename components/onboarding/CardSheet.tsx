'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { X, Loader2, Search } from 'lucide-react'
import { cn, formatMYDate, formatMYTime } from '@/lib/utils'
import {
  ONBOARDING_STEPS, stepLabel, nextStep, needsStoreLink, daysOnStep, isRedCard,
  type OnboardingStep,
} from '@/lib/onboarding/steps'
import { callOnboardingApi } from '@/components/onboarding/api'
import type { OnboardingCardRow, OnboardingHistoryEntry, XocksTeamMember, Store } from '@/types'

interface CardSheetProps {
  card: OnboardingCardRow
  members: XocksTeamMember[]
  workingAs: string
  now: Date
  onClose: () => void
  onMove: (card: OnboardingCardRow, to: OnboardingStep) => Promise<void>
  onCreateStore: (card: OnboardingCardRow) => void
  onChanged: () => Promise<void>
}

type Draft = {
  store_name: string
  pic_name: string
  pic_phone: string
  company_name: string
  company_address: string
  company_email: string
  shipment_address: string
  shipment_contact: string
  shipment_pic: string
  store_type: string
  notes: string
  follow_up_date: string
  handler_member_id: string
}

function draftFrom(card: OnboardingCardRow): Draft {
  return {
    store_name: card.store_name,
    pic_name: card.pic_name,
    pic_phone: card.pic_phone,
    company_name: card.company_name ?? '',
    company_address: card.company_address ?? '',
    company_email: card.company_email ?? '',
    shipment_address: card.shipment_address ?? '',
    shipment_contact: card.shipment_contact ?? '',
    shipment_pic: card.shipment_pic ?? '',
    store_type: card.store_type ?? '',
    notes: card.notes ?? '',
    follow_up_date: card.follow_up_date ?? '',
    handler_member_id: card.handler_member_id ?? '',
  }
}

/** Side panel for one card: details, step, store link, follow-up, handler and history. */
export function CardSheet({ card, members, workingAs, now, onClose, onMove, onCreateStore, onChanged }: CardSheetProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(card))
  const [history, setHistory] = useState<OnboardingHistoryEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [moveTo, setMoveTo] = useState<OnboardingStep>(card.step)
  const [storeQuery, setStoreQuery] = useState('')
  const [storeResults, setStoreResults] = useState<Store[]>([])
  const [searching, setSearching] = useState(false)

  // Reset the form when a different card is opened or the card is saved elsewhere
  useEffect(() => {
    setDraft(draftFrom(card))
    setMoveTo(card.step)
    setStoreQuery('')
    setStoreResults([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.updated_at])

  useEffect(() => {
    let cancelled = false
    callOnboardingApi<{ history: OnboardingHistoryEntry[] }>(`/api/onboarding/cards/${card.id}`)
      .then((res) => { if (!cancelled) setHistory(res.history) })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load history'))
    return () => { cancelled = true }
  }, [card.id, card.step_changed_at])

  const linked = !!card.store_id
  const red = isRedCard(card, now)
  const next = nextStep(card.step)
  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }))

  async function save() {
    if (!workingAs) { toast.error('Pick who you are at the top of the board first'); return }
    setSaving(true)
    try {
      await callOnboardingApi(`/api/onboarding/cards/${card.id}`, 'PATCH', {
        by_member_id: workingAs,
        store_name: draft.store_name,
        pic_name: draft.pic_name,
        pic_phone: draft.pic_phone,
        company_name: draft.company_name,
        company_address: draft.company_address,
        company_email: draft.company_email,
        shipment_address: draft.shipment_address,
        shipment_contact: draft.shipment_contact,
        shipment_pic: draft.shipment_pic,
        store_type: draft.store_type,
        notes: draft.notes,
        follow_up_date: draft.follow_up_date || null,
        handler_member_id: draft.handler_member_id || null,
      })
      toast.success('Card saved')
      await onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save card')
    } finally {
      setSaving(false)
    }
  }

  async function searchStores() {
    const q = storeQuery.trim()
    if (!q) return
    setSearching(true)
    try {
      const res = await callOnboardingApi<{ stores: Store[] }>(`/api/stores?search=${encodeURIComponent(q)}&limit=8`)
      setStoreResults(res.stores)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Store search failed')
    } finally {
      setSearching(false)
    }
  }

  async function linkStore(store: Store) {
    if (!workingAs) { toast.error('Pick who you are at the top of the board first'); return }
    try {
      await callOnboardingApi(`/api/onboarding/cards/${card.id}`, 'PATCH', { by_member_id: workingAs, store_id: store.id })
      toast.success(`Linked to ${store.store_name}`)
      await onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not link store')
    }
  }

  const input = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#FFD700]'
  const label = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative w-full sm:max-w-lg h-full bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">{card.store_name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {stepLabel(card.step)} · {daysOnStep(card.step_changed_at, now)} day(s) on this step
              {red && <span className="ml-2 font-semibold text-red-600">Needs follow-up</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Step */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-800">Step</h3>
            <div className="flex gap-2">
              <select
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value as OnboardingStep)}
                className={cn(input, 'flex-1')}
              >
                {ONBOARDING_STEPS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button
                onClick={() => onMove(card, moveTo)}
                disabled={moveTo === card.step}
                className="px-3 py-2 text-sm font-semibold rounded-lg bg-[#0A0A0A] text-[#FFD700] disabled:opacity-40"
              >
                Move
              </button>
            </div>
            {next && (
              <button
                onClick={() => onMove(card, next)}
                className="text-sm font-medium text-gray-700 underline underline-offset-2"
              >
                Next step: {stepLabel(next)}
              </button>
            )}
            {card.step === 'first_sale' && card.first_sale_at && (
              <p className="text-xs text-gray-500">First sale on {formatMYDate(card.first_sale_at)}. It leaves the board 7 days after this, and stays searchable.</p>
            )}
            {!linked && card.step === 'details_received' && (
              <button
                onClick={() => onCreateStore(card)}
                className="w-full py-2 text-sm font-semibold rounded-lg bg-[#FFD700] text-black"
              >
                Create store from these details
              </button>
            )}
          </section>

          {/* Store link */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-800">Store record</h3>
            {linked && card.store ? (
              <p className="text-sm">
                <Link href={`/admin/stores/${card.store_id}`} className="font-medium text-gray-900 underline underline-offset-2">
                  {card.store.store_code} · {card.store.store_name}
                </Link>
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  Not linked yet. Account created and later steps need the store record. Find it here, or use Create store.
                </p>
                <div className="flex gap-2">
                  <input
                    value={storeQuery}
                    onChange={(e) => setStoreQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') searchStores() }}
                    placeholder="Search store name or code"
                    className={cn(input, 'flex-1')}
                  />
                  <button onClick={searchStores} disabled={searching} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </button>
                </div>
                {storeResults.length > 0 && (
                  <ul className="border border-gray-100 rounded-lg divide-y divide-gray-100">
                    {storeResults.map((s) => (
                      <li key={s.id}>
                        <button onClick={() => linkStore(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                          <span className="font-medium">{s.store_code}</span> · {s.store_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* Follow-up and handler */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Next follow-up</label>
              <input type="date" value={draft.follow_up_date} onChange={(e) => set('follow_up_date')(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Handled by</label>
              <select value={draft.handler_member_id} onChange={(e) => set('handler_member_id')(e.target.value)} className={input}>
                <option value="">Not assigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </section>

          {/* Details */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Store name (card)</label>
                <input value={draft.store_name} onChange={(e) => set('store_name')(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Store type</label>
                <input value={draft.store_type} onChange={(e) => set('store_type')(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Company name</label>
                <input value={draft.company_name} onChange={(e) => set('company_name')(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Company email</label>
                <input type="email" value={draft.company_email} onChange={(e) => set('company_email')(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>PIC name</label>
                <input value={draft.pic_name} onChange={(e) => set('pic_name')(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Company / PIC phone</label>
                <input value={draft.pic_phone} onChange={(e) => set('pic_phone')(e.target.value)} className={input} />
              </div>
            </div>
            <div>
              <label className={label}>Company address</label>
              <textarea rows={2} value={draft.company_address} onChange={(e) => set('company_address')(e.target.value)} className={input} />
            </div>
            <div className="rounded-lg bg-gray-50 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-700">Shipment (printed on DOs and packing slips when filled)</p>
              <div>
                <label className={label}>Shipment address</label>
                <textarea rows={2} value={draft.shipment_address} onChange={(e) => set('shipment_address')(e.target.value)} className={input} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Shipment contact</label>
                  <input value={draft.shipment_contact} onChange={(e) => set('shipment_contact')(e.target.value)} className={input} />
                </div>
                <div>
                  <label className={label}>Shipment PIC</label>
                  <input value={draft.shipment_pic} onChange={(e) => set('shipment_pic')(e.target.value)} className={input} />
                </div>
              </div>
            </div>
            <div>
              <label className={label}>Notes</label>
              <textarea rows={3} value={draft.notes} onChange={(e) => set('notes')(e.target.value)} className={input} />
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="w-full py-2.5 text-sm font-semibold rounded-lg bg-[#0A0A0A] text-[#FFD700] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save details'}
            </button>
          </section>

          {/* History */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-800">History</h3>
            {history.length === 0 ? (
              <p className="text-xs text-gray-500">No history yet.</p>
            ) : (
              <ol className="space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="text-xs text-gray-700 border-l-2 border-gray-200 pl-3">
                    <span className="font-medium">
                      {h.from_step ? `${stepLabel(h.from_step)} → ${stepLabel(h.to_step)}` : `Added at ${stepLabel(h.to_step)}`}
                    </span>
                    <span className="block text-gray-500">
                      {formatMYTime(h.moved_at)} · by {h.mover?.name ?? 'unknown'}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {needsStoreLink(card.step) && !linked && (
            <p className="text-xs text-red-600">This card is past Account created but has no store linked. Link it above.</p>
          )}
        </div>
      </aside>
    </div>
  )
}
