'use client'

/**
 * Store owner guided tour. Mounted once in the store layout; draws only an
 * overlay on top of the existing pages. It never changes page layout, styling
 * or behaviour. Progress is saved to the owner's profile (tour_* columns).
 * If the tour data is missing or a write fails, the store pages still work.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/components/store/StoreContext'
import { type SignableDO } from '@/lib/delivery-orders/initial-signature'
import { TOUR_UI, type Bilingual, type Lang, type TourStep } from '@/lib/tour/content'
import { activeSteps, hasUnsignedFirstDO, promptFor, startIndex } from '@/lib/tour/logic'
import { cn } from '@/lib/utils'
import type { TourStatus } from '@/types'

type Phase = 'idle' | 'welcome' | 'offer' | 'resume' | 'tour' | 'finish'

interface TourRow {
  userId: string
  storeId: string
  status: TourStatus | null
  step: number | null
  lang: Lang
}

interface Box { top: number; left: number; width: number; height: number }

/** Event the Home "Start tour" button dispatches. */
export const START_TOUR_EVENT = 'xcms:start-tour'

const PROMPT_KEY = 'xcms-tour-prompted'

function promptedThisSession(): boolean {
  try { return sessionStorage.getItem(PROMPT_KEY) === '1' } catch { return false }
}
function markPrompted() {
  try { sessionStorage.setItem(PROMPT_KEY, '1') } catch { /* private mode: prompt may repeat */ }
}

function visibleBox(el: Element | null): Box | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

function findTarget(selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el && visibleBox(el)) return el
  }
  return null
}

export default function StoreTour() {
  const pathname = usePathname()
  const router = useRouter()
  const { store } = useStore()

  const [row, setRow] = useState<TourRow | null>(null)
  const [hasDO, setHasDO] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [lang, setLang] = useState<Lang>('en')
  const [steps, setSteps] = useState<TourStep[]>([])
  const [index, setIndex] = useState(0)
  const [spot, setSpot] = useState<Box | null>(null)
  const [navSpot, setNavSpot] = useState<Box | null>(null)

  // Refs let async callbacks read the latest row without stale closures.
  const rowRef = useRef<TourRow | null>(null)
  const beginRef = useRef<(fromStepId?: number | null) => Promise<void>>(async () => {})
  const hasDORef = useRef(false)

  // 1. Load this owner's tour state (store owners only).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data, error } = await supabase
          .from('profiles')
          .select('role, store_id, tour_status, tour_step, tour_lang')
          .eq('id', user.id)
          .single()
        if (error || !data || data.role !== 'store_owner' || !data.store_id) return

        const { data: orders } = await supabase
          .from('delivery_orders')
          .select('do_type, status, pdf_url, created_at')
          .eq('store_id', data.store_id)
          .eq('do_type', 'initial')
        const unsigned = hasUnsignedFirstDO((orders ?? []) as SignableDO[])
        if (cancelled) return

        const r: TourRow = {
          userId: user.id,
          storeId: data.store_id,
          status: (data.tour_status as TourStatus | null) ?? null,
          step: data.tour_step ?? null,
          lang: data.tour_lang === 'bm' ? 'bm' : 'en',
        }
        rowRef.current = r
        hasDORef.current = unsigned
        setRow(r)
        setHasDO(unsigned)
        setLang(r.lang)

        // Automatic prompt: at most once per browser session.
        const kind = promptFor(r.status)
        if (kind && !promptedThisSession()) {
          markPrompted()
          setPhase(kind)
        }
      } catch {
        // The tour is optional. Never break the store page over it.
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 2. Save progress. Updates the local copy too.
  const saveTrack = useCallback(async (patch: Partial<Record<'tour_status' | 'tour_step' | 'tour_lang' | 'tour_completed_at', unknown>>) => {
    const r = rowRef.current
    if (!r) return
    if (patch.tour_status !== undefined) r.status = patch.tour_status as TourStatus
    if (patch.tour_step !== undefined) r.step = patch.tour_step as number
    if (patch.tour_lang !== undefined) r.lang = patch.tour_lang as Lang
    try {
      const { error } = await createClient().from('profiles').update(patch).eq('id', r.userId)
      if (error) throw error
    } catch {
      toast.error(r.lang === 'bm' ? 'Kemajuan lawatan tidak dapat disimpan' : 'Could not save tour progress')
    }
  }, [])

  // 3. Start (or resume) the tour from a given stable step id.
  const beginTour = useCallback(async (fromStepId?: number | null) => {
    const r = rowRef.current
    if (!r) return
    const list = activeSteps(hasDORef.current)
    const idx = startIndex(list, fromStepId)
    setSteps(list)
    setIndex(idx)
    setPhase('tour')
    if (r.status !== 'completed') {
      void saveTrack({ tour_status: 'in_progress', tour_step: list[idx].id })
    }
  }, [saveTrack])
  useEffect(() => { beginRef.current = beginTour }, [beginTour])

  // Home "Start tour" button: replay from step 1.
  useEffect(() => {
    const onStart = () => { if (rowRef.current) void beginRef.current(1) }
    window.addEventListener(START_TOUR_EVENT, onStart)
    return () => window.removeEventListener(START_TOUR_EVENT, onStart)
  }, [])

  const current: TourStep | undefined = phase === 'tour' ? steps[index] : undefined
  const isLast = current !== undefined && index === steps.length - 1

  // 4. Navigate to the step's page; the tour moves between pages itself.
  useEffect(() => {
    if (phase === 'tour' && current && pathname !== current.page) {
      router.push(current.page)
    }
  }, [phase, current, pathname, router])

  // 5. Find the target and track its position (scroll, resize, layout shifts).
  useEffect(() => {
    if (phase !== 'tour' || !current || pathname !== current.page) {
      setSpot(null)
      setNavSpot(null)
      return
    }
    let scrolled = false
    const tick = () => {
      const el = findTarget(current.targets)
      if (el && !scrolled) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        scrolled = true
      }
      const box = el ? visibleBox(el) : null
      setSpot((prev) => (sameBox(prev, box) ? prev : box))
      const nav = document.querySelector(`nav a[href="${current.page}"]`)
      const navBox = visibleBox(nav)
      setNavSpot((prev) => (sameBox(prev, navBox) ? prev : navBox))
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [phase, current, pathname])

  // ── Actions ────────────────────────────────────────────────────────────────

  function chooseLang(next: Lang) {
    setLang(next)
    if (rowRef.current && rowRef.current.lang !== next) void saveTrack({ tour_lang: next })
  }

  function snooze() {
    void saveTrack({ tour_status: 'snoozed' })
    setPhase('idle')
  }

  function decline() {
    void saveTrack({ tour_status: 'declined' })
    setPhase('idle')
  }

  function skipTour() {
    const step = steps[index]
    if (step && rowRef.current?.status !== 'completed') {
      void saveTrack({ tour_status: 'in_progress', tour_step: step.id })
    }
    setPhase('idle')
  }

  function goBack() {
    if (index > 0) setIndex(index - 1)
  }

  function goNext() {
    if (!isLast) {
      const to = index + 1
      setIndex(to)
      if (rowRef.current?.status !== 'completed') {
        void saveTrack({ tour_status: 'in_progress', tour_step: steps[to].id })
      }
      return
    }
    // Finish: record completion once (replays keep the original date).
    if (rowRef.current && rowRef.current.status !== 'completed') {
      void saveTrack({
        tour_status: 'completed',
        tour_step: steps[index].id,
        tour_completed_at: new Date().toISOString(),
      })
    }
    setPhase('finish')
  }

  if (!row) return null
  const L = (t: Bilingual) => t[lang]
  const storeName = store?.store_name ?? (lang === 'bm' ? 'kedai anda' : 'your store')

  // ── Sheets (welcome / offer / resume / finish) ─────────────────────────────

  if (phase === 'welcome' || phase === 'offer' || phase === 'resume' || phase === 'finish') {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 sm:items-center"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 text-[#0A0A0A] shadow-2xl">
          {phase === 'welcome' && (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="text-3xl" aria-hidden>{TOUR_UI.welcome.emoji}</span>
                <LangToggle lang={lang} onChange={chooseLang} />
              </div>
              <h2 className="mt-2 text-lg font-bold leading-snug">{L(TOUR_UI.welcome.title(storeName))}</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{L(TOUR_UI.welcome.body)}</p>
              <div className="mt-5 space-y-2">
                <PrimaryButton onClick={() => void beginTour(null)}>{L(TOUR_UI.buttons.start)}</PrimaryButton>
                <SecondaryButton onClick={snooze}>{L(TOUR_UI.buttons.maybeLater)}</SecondaryButton>
              </div>
            </>
          )}

          {phase === 'offer' && (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="text-3xl" aria-hidden>{TOUR_UI.offer.emoji}</span>
                <LangToggle lang={lang} onChange={chooseLang} />
              </div>
              <h2 className="mt-2 text-lg font-bold leading-snug">{L(TOUR_UI.offer.title)}</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{L(TOUR_UI.offer.body)}</p>
              <div className="mt-5 space-y-2">
                <PrimaryButton onClick={() => void beginTour(null)}>{L(TOUR_UI.buttons.start)}</PrimaryButton>
                <SecondaryButton onClick={snooze}>{L(TOUR_UI.buttons.maybeLater)}</SecondaryButton>
                <button type="button" onClick={decline} className="h-11 w-full text-sm font-medium text-gray-500">
                  {L(TOUR_UI.buttons.noThanks)}
                </button>
              </div>
            </>
          )}

          {phase === 'resume' && (() => {
            const list = activeSteps(hasDO)
            const n = startIndex(list, row.step) + 1
            return (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-3xl" aria-hidden>{TOUR_UI.resume.emoji}</span>
                  <LangToggle lang={lang} onChange={chooseLang} />
                </div>
                <h2 className="mt-2 text-lg font-bold leading-snug">{L(TOUR_UI.resume.title)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{L(TOUR_UI.resume.body(n, list.length))}</p>
                <div className="mt-5 space-y-2">
                  <PrimaryButton onClick={() => void beginTour(row.step)}>{L(TOUR_UI.buttons.continue)}</PrimaryButton>
                  <SecondaryButton onClick={() => setPhase('idle')}>{L(TOUR_UI.buttons.notNow)}</SecondaryButton>
                </div>
              </>
            )
          })()}

          {phase === 'finish' && (() => {
            const delivery = hasDO
            const copy = delivery ? TOUR_UI.finishDelivery : TOUR_UI.finish
            return (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-3xl" aria-hidden>{copy.emoji}</span>
                  <LangToggle lang={lang} onChange={chooseLang} />
                </div>
                <h2 className="mt-2 text-lg font-bold leading-snug">{L(copy.title)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{L(copy.body)}</p>
                <div className="mt-5">
                  {delivery ? (
                    <PrimaryButton onClick={() => { setPhase('idle'); router.push('/store/delivery-orders') }}>
                      {L(TOUR_UI.buttons.goDelivery)}
                    </PrimaryButton>
                  ) : (
                    <PrimaryButton onClick={() => setPhase('idle')}>{L(TOUR_UI.buttons.done)}</PrimaryButton>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      </div>
    )
  }

  // ── Tour overlay ───────────────────────────────────────────────────────────

  if (phase !== 'tour' || !current) return null

  const total = steps.length
  const cardBelowTarget = spot ? spot.top + spot.height / 2 < window.innerHeight / 2 : false
  const cardPos: React.CSSProperties = !spot
    ? { top: '50%', transform: 'translate(-50%, -50%)' }
    : cardBelowTarget
      // Target is in the upper half: card sits above the bottom nav.
      ? { bottom: 'calc(env(safe-area-inset-bottom) + 84px)', transform: 'translateX(-50%)' }
      // Target is in the lower half: card sits under the header.
      : { top: 'calc(env(safe-area-inset-top) + 72px)', transform: 'translateX(-50%)' }

  return (
    <>
      {/* Blocker: taps on the page do nothing while the tour is open. */}
      <div className="fixed inset-0 z-[90]" aria-hidden />

      {/* Spotlight: gold ring around the target, everything else dimmed. */}
      {spot ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[91] rounded-xl transition-[top,left,width,height] duration-200"
          style={{
            top: spot.top - 6,
            left: spot.left - 6,
            width: spot.width + 12,
            height: spot.height + 12,
            boxShadow: '0 0 0 3px #FFD700, 0 0 0 9999px rgba(0, 0, 0, 0.72)',
          }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[91] bg-black/70" />
      )}

      {/* Bottom-nav tab for this step's page: gold outline and underline. */}
      {navSpot && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[92] rounded-xl transition-[top,left,width,height] duration-200"
          style={{
            top: navSpot.top + 2,
            left: navSpot.left + 4,
            width: navSpot.width - 8,
            height: navSpot.height - 4,
            boxShadow: '0 0 0 2px #FFD700',
          }}
        >
          <span className="absolute bottom-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-[#FFD700]" />
        </div>
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={L(current.title)}
        className="fixed left-1/2 z-[100] w-[calc(100vw-32px)] max-w-[380px] rounded-2xl bg-white p-4 text-[#0A0A0A] shadow-2xl"
        style={cardPos}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold tracking-wide text-[#B45309]" style={{ fontVariant: 'small-caps' }}>
            {L(current.tab)}
          </p>
          <LangToggle lang={lang} onChange={chooseLang} />
        </div>
        <h3 className="mt-1 text-base font-bold leading-snug">{L(current.title)}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{L(current.body)}</p>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1}>
          <div className="h-full rounded-full bg-[#FFD700] transition-all duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <p className="mt-1.5 text-right text-[11px] text-gray-500">{index + 1} {L(TOUR_UI.of)} {total}</p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={skipTour} className="h-10 px-2 text-sm font-medium text-gray-500">
            {L(TOUR_UI.buttons.skip)}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={index === 0}
              className="h-10 rounded-xl border border-gray-300 px-4 text-sm font-semibold disabled:opacity-40"
            >
              {L(TOUR_UI.buttons.back)}
            </button>
            <button
              type="button"
              onClick={goNext}
              className="h-10 rounded-xl bg-[#0A0A0A] px-5 text-sm font-bold text-[#FFD700]"
            >
              {isLast ? L(TOUR_UI.buttons.finish) : L(TOUR_UI.buttons.next)}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div role="group" aria-label="Language" className="flex shrink-0 rounded-full border border-gray-200 p-0.5 text-[11px] font-bold">
      {(['en', 'bm'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => onChange(l)}
          className={cn(
            'h-7 min-w-[38px] rounded-full px-2 transition-colors',
            lang === l ? 'bg-[#0A0A0A] text-[#FFD700]' : 'text-gray-500',
          )}
        >
          {l === 'en' ? 'EN' : 'BM'}
        </button>
      ))}
    </div>
  )
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-11 w-full rounded-xl bg-[#0A0A0A] text-sm font-bold text-[#FFD700]">
      {children}
    </button>
  )
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-11 w-full rounded-xl border border-gray-300 text-sm font-semibold text-[#0A0A0A]">
      {children}
    </button>
  )
}
