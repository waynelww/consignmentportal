'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2, MessageCircle, Search, Flame, Archive } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { useXocksTeam } from '@/components/admin/useXocksTeam'
import { CardSheet } from '@/components/onboarding/CardSheet'
import { CloseCardDialog } from '@/components/onboarding/CloseCardDialog'
import { callOnboardingApi } from '@/components/onboarding/api'
import { cn, formatMYDate } from '@/lib/utils'
import { normalizePhone } from '@/lib/gang/phone'
import {
  ONBOARDING_STEPS, stepLabel, nextStep, needsStoreLink, daysOnStep, isRedCard, isOffBoard,
  compareOldestFirst, todayMYT, closeReasonLabel, type OnboardingStep,
} from '@/lib/onboarding/steps'
import type { OnboardingCardRow } from '@/types'

const WORKING_AS_KEY = 'xcms.onboarding.workingAs'

/** Ticks once a minute so red cards turn red without a reload. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function matchesSearch(card: OnboardingCardRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [
    card.store_name, card.pic_name, card.company_name, card.store_type,
    card.store?.store_name, card.store?.store_code,
  ]
  if (fields.some((f) => f && f.toLowerCase().includes(q))) return true
  const digits = q.replace(/\D/g, '')
  return digits.length > 0 && card.pic_phone.replace(/\D/g, '').includes(digits)
}

export default function OnboardingPage() {
  const router = useRouter()
  const now = useNow()
  const { members } = useXocksTeam()

  const [cards, setCards] = useState<OnboardingCardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // One view at a time: the board, the follow-up list, or the closed list.
  const [view, setView] = useState<'board' | 'followUp' | 'closed'>('board')
  const [closingCard, setClosingCard] = useState<OnboardingCardRow | null>(null)
  const [workingAs, setWorkingAs] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // "Working as" is remembered per browser only; every change records it.
  useEffect(() => {
    try {
      setWorkingAs(localStorage.getItem(WORKING_AS_KEY) ?? '')
    } catch { /* storage unavailable: the picker just starts empty */ }
  }, [])
  function pickWorkingAs(id: string) {
    setWorkingAs(id)
    try { localStorage.setItem(WORKING_AS_KEY, id) } catch { /* not remembered */ }
  }

  const loadCards = useCallback(async () => {
    try {
      const res = await callOnboardingApi<{ cards: OnboardingCardRow[] }>('/api/onboarding/cards')
      setCards(res.cards)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load onboarding cards')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCards() }, [loadCards])

  const selected = cards.find((c) => c.id === selectedId) ?? null

  const memberName = members.find((m) => m.id === workingAs)?.name ?? null
  const openCards = useMemo(() => cards.filter((c) => !c.closed_at), [cards])
  const closedCount = cards.length - openCards.length
  const redCount = useMemo(() => openCards.filter((c) => isRedCard(c, now)).length, [openCards, now])

  // What to show: a flat list for the follow-up and closed views or while searching; otherwise the board.
  const searching = search.trim().length > 0
  const listCards = useMemo(() => {
    if (view === 'closed') {
      return cards
        .filter((c) => c.closed_at && matchesSearch(c, search))
        .sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''))
    }
    const base = openCards.filter((c) => matchesSearch(c, search))
    if (view === 'followUp') return base.filter((c) => isRedCard(c, now)).sort(compareOldestFirst)
    return base.sort(compareOldestFirst)
  }, [cards, openCards, search, view, now])
  const showList = searching || view !== 'board'

  async function moveCard(card: OnboardingCardRow, to: OnboardingStep) {
    if (!workingAs) { toast.error('Pick who you are at the top of the board first'); return }
    if (to === card.step) return
    if (needsStoreLink(to) && !card.store_id) {
      setSelectedId(card.id)
      toast.error(`Link the store record before moving to ${stepLabel(to)}`)
      return
    }
    setBusyId(card.id)
    try {
      await callOnboardingApi(`/api/onboarding/cards/${card.id}/move`, 'POST', {
        to_step: to,
        by_member_id: workingAs,
      })
      toast.success(`${card.store_name}: ${stepLabel(to)}`)
      await loadCards()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move card')
    } finally {
      setBusyId(null)
    }
  }

  async function reopenCard(card: OnboardingCardRow) {
    if (!workingAs) { toast.error('Pick who you are at the top of the board first'); return }
    try {
      await callOnboardingApi(`/api/onboarding/cards/${card.id}/reopen`, 'POST', { by_member_id: workingAs })
      toast.success(`${card.store_name} is back on the board at ${stepLabel(card.step)}`)
      await loadCards()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reopen the card')
    }
  }

  function createStore(card: OnboardingCardRow) {
    if (!workingAs) { toast.error('Pick who you are at the top of the board first'); return }
    router.push(`/admin/stores/new?card=${card.id}&by=${workingAs}`)
  }

  function renderCard(card: OnboardingCardRow, { showStep }: { showStep: boolean }) {
    const digits = normalizePhone(card.pic_phone)
    const red = isRedCard(card, now)
    const next = nextStep(card.step)
    const busy = busyId === card.id
    const followUpDue = card.follow_up_date !== null && card.follow_up_date <= todayMYT(now)
    return (
      <div
        key={card.id}
        draggable={!showList}
        onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
        onClick={() => setSelectedId(card.id)}
        className={cn(
          'rounded-xl border bg-white p-3 shadow-sm cursor-pointer hover:shadow transition-shadow',
          red ? 'border-red-400 bg-red-50' : 'border-gray-200',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-900 truncate">
              {card.store ? `${card.store.store_name}` : card.store_name}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {card.store ? card.store_name + ' · ' : ''}{card.pic_name}
            </p>
          </div>
          {red && <Flame className="h-4 w-4 text-red-500 flex-shrink-0" aria-label="Needs follow-up" />}
        </div>

        <div className="mt-2 space-y-1 text-xs text-gray-600">
          {digits ? (
            <a
              href={`https://wa.me/${digits}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-green-700 font-medium"
            >
              <MessageCircle className="h-3.5 w-3.5" /> {card.pic_phone}
            </a>
          ) : (
            <span>{card.pic_phone}</span>
          )}
          {showStep && <p className="font-medium text-gray-800">{stepLabel(card.step)}</p>}
          <p>
            {daysOnStep(card.step_changed_at, now)} day(s) on this step
            {card.follow_up_date && (
              <span className={cn('ml-2', followUpDue && 'font-semibold text-red-600')}>
                · Follow up {formatMYDate(card.follow_up_date)}
              </span>
            )}
          </p>
          <p>{card.handler ? `Handled by ${card.handler.name}` : 'Not assigned'}</p>
          {card.notes && <p className="line-clamp-2 text-gray-500">{card.notes}</p>}
        </div>

        <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
          {next && (
            <button
              onClick={() => moveCard(card, next)}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 text-xs font-semibold rounded-lg bg-[#0A0A0A] text-[#FFD700] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Next step
            </button>
          )}
          {card.step === 'details_received' && !card.store_id && (
            <button
              onClick={() => createStore(card)}
              className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-[#FFD700] text-black"
            >
              Create store
            </button>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setClosingCard(card) }}
          className="mt-2 w-full py-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-700 bg-white"
        >
          Remove store (deal rejected)
        </button>
      </div>
    )
  }

  function renderClosedCard(card: OnboardingCardRow) {
    return (
      <div
        key={card.id}
        onClick={() => setSelectedId(card.id)}
        className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm cursor-pointer hover:shadow transition-shadow"
      >
        <p className="font-semibold text-sm text-gray-900">{card.store ? card.store.store_name : card.store_name}</p>
        <p className="text-xs text-gray-500">{card.pic_name} · {card.pic_phone}</p>
        <p className="mt-1 text-xs text-gray-700">
          <span className="font-medium">{closeReasonLabel(card.close_reason)}</span>
          {card.closed_at && <> · {formatMYDate(card.closed_at)}</>}
          {' · by '}{card.closer?.name ?? 'unknown'}
        </p>
        {card.close_note && <p className="text-xs text-gray-500 mt-0.5">{card.close_note}</p>}
        <p className="text-xs text-gray-500">Was at {stepLabel(card.step)}</p>
        <button
          onClick={(e) => { e.stopPropagation(); reopenCard(card) }}
          className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0A0A0A] text-[#FFD700]"
        >
          Reopen
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Onboarding"
        description="Each new store from first contact to first sale. Drag a card or use Next step to move it."
        actions={
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-[#0A0A0A] text-[#FFD700]"
          >
            <Plus className="h-4 w-4" /> Add store
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search store, PIC, phone (includes finished)"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          />
        </div>
        <button
          onClick={() => setView((v) => (v === 'followUp' ? 'board' : 'followUp'))}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border',
            view === 'followUp' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-300',
          )}
        >
          <Flame className="h-4 w-4" /> Follow up today ({redCount})
        </button>
        <button
          onClick={() => setView((v) => (v === 'closed' ? 'board' : 'closed'))}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border',
            view === 'closed' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-700 border-gray-300',
          )}
        >
          <Archive className="h-4 w-4" /> Closed ({closedCount})
        </button>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Working as
          <select
            value={workingAs}
            onChange={(e) => pickWorkingAs(e.target.value)}
            className="px-2 py-2 text-sm border border-gray-200 rounded-lg bg-white"
          >
            <option value="">Choose…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      {!workingAs && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Pick who you are under &ldquo;Working as&rdquo;. Every move and edit is recorded against that name.
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : showList ? (
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs text-gray-500">
            {view === 'closed'
              ? 'Removed from the board. Nothing is deleted. Reopen a store to put it back at the step it was on.'
              : view === 'followUp' && !searching
                ? 'Cards that need follow-up today or earlier, oldest first. Red: follow-up date today or earlier, or with no follow-up date, more than 24 hours on the same step.'
                : 'Search results (open cards). Finished stores stay in search while they are on the board.'}
          </p>
          {listCards.length === 0 && <p className="text-sm text-gray-500 py-6">Nothing here.</p>}
          {listCards.map((c) => (view === 'closed' ? renderClosedCard(c) : renderCard(c, { showStep: true })))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {ONBOARDING_STEPS.map((s) => {
            const inColumn = openCards
              .filter((c) => c.step === s.key && !isOffBoard(c, now))
              .sort(compareOldestFirst)
            return (
              <div
                key={s.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const card = cards.find((c) => c.id === e.dataTransfer.getData('text/plain'))
                  if (card) moveCard(card, s.key)
                }}
                className="w-64 flex-shrink-0 rounded-xl bg-gray-100/70 p-2"
              >
                <div className="flex items-center justify-between px-1 pb-2">
                  <h2 className="text-sm font-semibold text-gray-800">{s.label}</h2>
                  <span className="text-xs text-gray-500">{inColumn.length}</span>
                </div>
                <div className="space-y-2 min-h-[120px]">
                  {inColumn.map((c) => renderCard(c, { showStep: false }))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selected && (
        <CardSheet
          card={selected}
          members={members}
          workingAs={workingAs}
          now={now}
          onClose={() => setSelectedId(null)}
          onMove={(card, to) => moveCard(card, to)}
          onCreateStore={createStore}
          onRemove={(card) => setClosingCard(card)}
          onReopen={reopenCard}
          onChanged={loadCards}
        />
      )}

      {closingCard && (
        <CloseCardDialog
          card={closingCard}
          closingAsName={memberName}
          workingAs={workingAs}
          onClose={() => setClosingCard(null)}
          onDone={async () => {
            setClosingCard(null)
            setSelectedId(null)
            await loadCards()
          }}
        />
      )}

      {addOpen && (
        <AddCardDialog
          workingAs={workingAs}
          onClose={() => setAddOpen(false)}
          onAdded={async () => {
            setAddOpen(false)
            await loadCards()
          }}
        />
      )}
    </div>
  )
}

function AddCardDialog({ workingAs, onClose, onAdded }: { workingAs: string; onClose: () => void; onAdded: () => Promise<void> }) {
  const [storeName, setStoreName] = useState('')
  const [picName, setPicName] = useState('')
  const [picPhone, setPicPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const input = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#FFD700]'

  async function submit() {
    if (!workingAs) { toast.error('Pick who you are at the top of the board first'); return }
    setSaving(true)
    try {
      await callOnboardingApi('/api/onboarding/cards', 'POST', {
        by_member_id: workingAs,
        store_name: storeName,
        pic_name: picName,
        pic_phone: picPhone,
      })
      toast.success('Store added at Reached out')
      await onAdded()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add store')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Add store</h2>
        <p className="text-xs text-gray-500">Just the basics for now. Fill in the rest on the card later.</p>
        <div className="space-y-3">
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Store name" className={input} />
          <input value={picName} onChange={(e) => setPicName(e.target.value)} placeholder="PIC name" className={input} />
          <input value={picPhone} onChange={(e) => setPicPhone(e.target.value)} placeholder="Phone (WhatsApp)" className={input} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-200">Cancel</button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#0A0A0A] text-[#FFD700] disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add store'}
          </button>
        </div>
      </div>
    </div>
  )
}
