'use client'

// Event Target Calculator, embedded on an event's page and saved against
// that event (event_targets.event_id). Name + start date come from the event.
// Maths: lib/events/target-calc.ts (unchanged); the API recalculates on save.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Target, Lock, Unlock, Copy, Save, Plus, X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  calcTargets, defaultWeights, whatsappBrief, fmtRM, DEFAULT_SETTINGS,
  type TargetSettings, type EventLevel, type DayInput,
} from '@/lib/events/target-calc'

interface DayRow { id: string; label: string; crew: number; weight_pct: number }
interface SavedTarget {
  id: string
  event_level: EventLevel
  rental: number; delivery: number; other_fixed: number; pt_daily_rate: number
  pt_days: number; tier2_total: number; per_head_tier2: number
  actual_sales: number | null; tier2_hits: number | null; review_notes: string | null
  locked_at: string | null
  event_target_days: { label: string; crew: number; weight_pct: number; position: number }[]
}

const LEVELS: { key: EventLevel; name: string; desc: string }[] = [
  { key: 'small', name: 'Small', desc: 'Community market, first-time organiser' },
  { key: 'medium', name: 'Medium', desc: 'Mall event, festival, school fest' },
  { key: 'major', name: 'Major', desc: 'Annual crowd-puller (AOS, Boom+, Hausboom)' },
]

let dayIdSeq = 0
const newDay = (label: string, crew: number): DayRow => ({ id: `d${++dayIdSeq}`, label, crew, weight_pct: 0 })
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-MY', { weekday: 'short', timeZone: 'UTC' })
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function daysForEvent(start: string, end: string | null): DayRow[] {
  const n = end && end > start ? Math.min(14, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1) : 3
  const days = Array.from({ length: n }, (_, i) => newDay(end ? weekday(addDays(start, i)) : ['Fri', 'Sat', 'Sun'][i] ?? `Day ${i + 1}`, i === 0 ? 4 : 5))
  const w = defaultWeights(days.length)
  days.forEach((d, i) => { d.weight_pct = w[i] })
  return days
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400'
const labelCls = 'block text-xs font-medium text-gray-500 mb-1'

export interface TargetCalculatorProps {
  eventId: string
  eventName: string
  startDate: string
  endDate: string | null
  onSaved?: () => void
}

export function TargetCalculator({ eventId, eventName, startDate, endDate, onSaved }: TargetCalculatorProps) {
  const [settings, setSettings] = useState<TargetSettings>(DEFAULT_SETTINGS)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<SavedTarget | null>(null)

  const [targetId, setTargetId] = useState<string | null>(null)
  const [lockedAt, setLockedAt] = useState<string | null>(null)
  const [level, setLevel] = useState<EventLevel>('medium')
  const [perHeadOverride, setPerHeadOverride] = useState('')
  const [rental, setRental] = useState(0)
  const [delivery, setDelivery] = useState(280)
  const [otherFixed, setOtherFixed] = useState(300)
  const [ptRate, setPtRate] = useState(120)
  const [days, setDays] = useState<DayRow[]>(() => daysForEvent(startDate, endDate))
  const [saving, setSaving] = useState(false)

  const [actual, setActual] = useState('')
  const [hits, setHits] = useState('')
  const [notes, setNotes] = useState('')

  const locked = !!lockedAt

  const load = useCallback(async () => {
    setLoading(true)
    const [tRes, sRes] = await Promise.all([
      fetch(`/api/event-targets?event_id=${eventId}`),
      fetch('/api/event-targets/settings'),
    ])
    const tBody = await tRes.json().catch(() => ({}))
    const sBody = await sRes.json().catch(() => ({}))
    if (sRes.ok && sBody.settings) { setSettings(sBody.settings); setIsAdmin(!!sBody.is_admin) }
    const t: SavedTarget | undefined = tRes.ok ? tBody.events?.[0] : undefined
    setSaved(t ?? null)
    if (t) {
      setTargetId(t.id); setLockedAt(t.locked_at); setLevel(t.event_level)
      setRental(Number(t.rental)); setDelivery(Number(t.delivery)); setOtherFixed(Number(t.other_fixed)); setPtRate(Number(t.pt_daily_rate))
      setDays([...t.event_target_days].sort((a, b) => a.position - b.position)
        .map((d) => ({ id: `d${++dayIdSeq}`, label: d.label, crew: Number(d.crew), weight_pct: Number(d.weight_pct) })))
      setActual(t.actual_sales != null ? String(t.actual_sales) : '')
      setHits(t.tier2_hits != null ? String(t.tier2_hits) : '')
      setNotes(t.review_notes ?? '')
    }
    setLoading(false)
  }, [eventId])

  useEffect(() => { load() }, [load])

  const calc = useMemo(() => {
    const dayInputs: DayInput[] = days.map((d) => ({ label: d.label, crew: d.crew || 0, weight_pct: d.weight_pct || 0 }))
    if (!dayInputs.length) return null
    const result = calcTargets({
      level,
      per_head_override: perHeadOverride ? Number(perHeadOverride) : null,
      rental: rental || 0, delivery: delivery || 0, other_fixed: otherFixed || 0, pt_daily_rate: ptRate || 0,
      days: dayInputs,
    }, settings)
    return result.pt_days > 0 && result.per_head_tier2 > 0 ? result : null
  }, [days, level, perHeadOverride, rental, delivery, otherFixed, ptRate, settings])

  const brief = useMemo(() => (calc ? whatsappBrief(eventName, calc, settings) : ''), [calc, eventName, settings])

  function setDay(i: number, patch: Partial<DayRow>) { setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d))) }
  function reweight(ds: DayRow[]) { const w = defaultWeights(ds.length); return ds.map((d, i) => ({ ...d, weight_pct: w[i] })) }

  async function save(): Promise<string | null> {
    setSaving(true)
    const res = await fetch(targetId ? `/api/event-targets/${targetId}` : '/api/event-targets', {
      method: targetId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        name: eventName,
        start_date: startDate,
        event_level: level,
        per_head_override: perHeadOverride ? Number(perHeadOverride) : null,
        rental: rental || 0, delivery: delivery || 0, other_fixed: otherFixed || 0, pt_daily_rate: ptRate || 0,
        days: days.map((d) => ({ label: d.label || 'Day', crew: d.crew || 0, weight_pct: d.weight_pct || 0 })),
      }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { toast.error(body.error || `Save failed (${res.status})`); return null }
    setTargetId(body.id)
    toast.success('Targets saved')
    load(); onSaved?.()
    return body.id as string
  }

  async function lockTarget() {
    const id = targetId ?? await save()
    if (!id) return
    const res = await fetch(`/api/event-targets/${id}/lock`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Lock failed'); return }
    setLockedAt(body.locked_at); toast.success('Locked — targets are frozen')
  }

  async function unlockTarget() {
    if (!targetId) return
    const res = await fetch(`/api/event-targets/${targetId}/lock`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Unlock failed'); return }
    setLockedAt(null); toast.success('Unlocked')
  }

  async function removeTarget() {
    if (!targetId || !confirm('Delete this event\'s targets? Bonuses switch off for this event until targets are saved again.')) return
    const res = await fetch(`/api/event-targets/${targetId}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Delete failed'); return }
    setTargetId(null); setLockedAt(null); setSaved(null); setDays(daysForEvent(startDate, endDate))
    toast.success('Targets deleted'); onSaved?.()
  }

  async function saveReview() {
    if (!targetId) { toast.error('Save the targets first'); return }
    const res = await fetch(`/api/event-targets/${targetId}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual_sales: actual === '' ? null : Number(actual), tier2_hits: hits === '' ? null : Number(hits), review_notes: notes.trim() || null }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Could not save review'); return }
    toast.success('Review saved'); load()
  }

  function copyBrief() {
    navigator.clipboard.writeText(brief)
      .then(() => toast.success('Brief copied — paste into WhatsApp'))
      .catch(() => toast.error('Copy failed — long-press the text below instead'))
  }

  const flag = useMemo(() => {
    if (!calc) return null
    if (calc.fixed_cost > 0 && calc.cover_ratio < settings.min_cover_ratio) {
      return { ok: false, text: `Team target (${fmtRM(calc.tier2_total)}) is only ${calc.cover_ratio.toFixed(1)}× the event cost (${fmtRM(calc.fixed_cost)}). Below ${settings.min_cover_ratio}× the event is weak — check the rental or crew size with Wayne before locking.` }
    }
    const t2s = calc.days.filter((d) => d.crew > 0).map((d) => d.per_person_tier2)
    return { ok: true, text: `Team target covers the event cost ${calc.cover_ratio.toFixed(1)}×, and per-person numbers (${fmtRM(Math.min(...t2s))}–${fmtRM(Math.max(...t2s))} Tier 2) are in the range past events of this level have hit.` }
  }, [calc, settings])

  const reviewOpen = targetId && startDate <= new Date().toISOString().slice(0, 10)

  if (loading) return <div className="bg-white rounded-xl border border-gray-100 p-5 text-sm text-gray-400">Loading targets…</div>

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Target className="w-4 h-4 text-[#B8860B]" /> Targets</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {targetId ? 'Saved for this event.' : 'No targets yet — bonuses are off for this event until you save them.'}
            {' '}Day 1 = {shortDate(startDate)}; each next row is the next calendar day.
          </p>
        </div>
        {targetId && (
          <span className={cn('text-xs font-semibold px-3 py-1.5 rounded-full', locked ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600')}>
            {locked ? '🔒 Locked — targets frozen' : 'Saved · editable'}
          </span>
        )}
      </div>

      <div>
        <label className={labelCls}>Event level</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {LEVELS.map((l) => (
            <button key={l.key} type="button" disabled={locked} onClick={() => setLevel(l.key)}
              className={cn('rounded-xl border-2 p-3 text-left transition-colors disabled:opacity-60',
                level === l.key ? 'border-[#FFD700] bg-yellow-50' : 'border-gray-200 hover:border-gray-300 bg-white')}>
              <div className="text-sm font-bold text-gray-900">{l.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">{l.desc}</div>
              <div className="text-xs font-semibold text-[#B8860B] mt-1">
                {fmtRM({ small: settings.per_head_small, medium: settings.per_head_medium, major: settings.per_head_major }[l.key])} / person / day
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div><label className={labelCls}>Rental (RM)</label>
          <input type="number" min={0} className={inputCls} value={rental} disabled={locked} onChange={(e) => setRental(+e.target.value)} /></div>
        <div><label className={labelCls}>Delivery / transport (RM)</label>
          <input type="number" min={0} className={inputCls} value={delivery} disabled={locked} onChange={(e) => setDelivery(+e.target.value)} /></div>
        <div><label className={labelCls}>Other fixed cost (RM)</label>
          <input type="number" min={0} className={inputCls} value={otherFixed} disabled={locked} onChange={(e) => setOtherFixed(+e.target.value)} /></div>
        <div><label className={labelCls}>Part-timer pay / day (RM)</label>
          <input type="number" min={0} className={inputCls} value={ptRate} disabled={locked} onChange={(e) => setPtRate(+e.target.value)} /></div>
      </div>

      <div className="space-y-2">
        {days.map((d, i) => (
          <div key={d.id} className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-2 items-end">
            <div><label className={labelCls}>Day {i + 1} · {shortDate(addDays(startDate, i))}</label>
              <input className={inputCls} value={d.label} disabled={locked} onChange={(e) => setDay(i, { label: e.target.value })} /></div>
            <div><label className={labelCls}>Part-timers</label>
              <input type="number" min={0} className={inputCls} value={d.crew} disabled={locked} onChange={(e) => setDay(i, { crew: +e.target.value })} /></div>
            <div><label className={labelCls}>Weight %</label>
              <input type="number" min={0} className={inputCls} value={d.weight_pct} disabled={locked} onChange={(e) => setDay(i, { weight_pct: +e.target.value })} /></div>
            <button type="button" disabled={locked} onClick={() => setDays((ds) => reweight(ds.filter((_, j) => j !== i)))}
              className="h-[38px] w-[38px] rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 disabled:opacity-40 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button type="button" disabled={locked} onClick={() => setDays((ds) => reweight([...ds, newDay(weekday(addDays(startDate, ds.length)), 4)]))}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-2 disabled:opacity-40">
          <Plus className="w-4 h-4" /> Add a day
        </button>
        <p className="text-xs text-gray-400">Weight % splits the event across days (3-day auto 25 / 40 / 35, 2-day 55 / 45). Edit if Saturday is the big day.</p>
      </div>

      {calc && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-xl bg-blue-50 p-4 text-center">
              <div className="text-xs text-blue-900/70 font-medium">Tier 1 · everyone hits it</div>
              <div className="text-2xl font-extrabold text-blue-950 mt-1">{fmtRM(calc.tier1_total)}</div>
              <div className="text-xs text-blue-900/60 mt-0.5">RM{settings.bonus_tier1} each per day</div>
            </div>
            <div className="rounded-xl bg-[#FFD84D] p-4 text-center">
              <div className="text-xs text-gray-800 font-medium">Tier 2 · team target</div>
              <div className="text-2xl font-extrabold text-gray-900 mt-1">{fmtRM(calc.tier2_total)}</div>
              <div className="text-xs text-gray-700 mt-0.5">RM{settings.bonus_tier2} each per day</div>
            </div>
            <div className="rounded-xl bg-[#1F4BD8] p-4 text-center">
              <div className="text-xs text-white/80 font-medium">Tier 3 · stretch</div>
              <div className="text-2xl font-extrabold text-white mt-1">{fmtRM(calc.tier3_total)}</div>
              <div className="text-xs text-white/70 mt-0.5">RM{settings.bonus_tier3} each per day</div>
            </div>
          </div>
          <p className="text-xs text-gray-500">Event costs (rental + delivery + other + part-timer pay × crew-days): <b>{fmtRM(calc.fixed_cost)}</b>. Bonuses unlock once POS sales pass costs + {fmtRM(Number((settings as TargetSettings & { profit_unlock_amount?: number }).profit_unlock_amount ?? 1000))}.</p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500">
                <th className="text-left py-2 px-2 font-medium">Day</th>
                <th className="text-right py-2 px-2 font-medium">Crew</th>
                <th className="text-right py-2 px-2 font-medium">Day target</th>
                <th className="text-right py-2 px-2 font-medium">Tier 1</th>
                <th className="text-right py-2 px-2 font-medium">Tier 2</th>
                <th className="text-right py-2 px-2 font-medium">Tier 3</th>
                <th className="text-right py-2 px-2 font-medium">Customers for T2<br /><span className="font-normal">at RM{settings.avg_sale_per_customer} each</span></th>
              </tr></thead>
              <tbody>
                {calc.days.map((d, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-2 px-2 font-medium text-gray-900">{d.label} <span className="text-xs text-gray-400">{shortDate(addDays(startDate, i))}</span></td>
                    <td className="py-2 px-2 text-right">{d.crew}</td>
                    <td className="py-2 px-2 text-right">{fmtRM(d.day_target_tier2)}</td>
                    <td className="py-2 px-2 text-right bg-blue-50">{d.crew ? fmtRM(d.per_person_tier1) : '–'}</td>
                    <td className="py-2 px-2 text-right bg-[#FFD84D] text-gray-900 font-extrabold text-base">{d.crew ? fmtRM(d.per_person_tier2) : '–'}</td>
                    <td className="py-2 px-2 text-right bg-[#1F4BD8] text-white">{d.crew ? fmtRM(d.per_person_tier3) : '–'}</td>
                    <td className="py-2 px-2 text-right">{d.crew ? `${d.customers_for_tier2} / person` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {flag && <div className={cn('rounded-lg px-4 py-3 text-sm', flag.ok ? 'bg-green-50 text-green-800' : 'bg-orange-50 text-orange-800')}>{flag.text}</div>}

          <div className="flex flex-wrap gap-2">
            <button onClick={copyBrief} className="flex items-center gap-1.5 bg-[#FFD700] hover:bg-[#f0cb00] text-gray-900 font-semibold text-sm rounded-lg px-4 py-2">
              <Copy className="w-4 h-4" /> Copy WhatsApp brief
            </button>
            <button onClick={save} disabled={saving || locked} className="flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save targets'}
            </button>
            {!locked && (
              <button onClick={lockTarget} className="flex items-center gap-1.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-sm font-medium rounded-lg px-4 py-2">
                <Lock className="w-4 h-4" /> Lock targets
              </button>
            )}
            {locked && isAdmin && (
              <button onClick={unlockTarget} className="flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2">
                <Unlock className="w-4 h-4" /> Unlock (admin)
              </button>
            )}
            {targetId && (!locked || isAdmin) && (
              <button onClick={removeTarget} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-600 px-3 py-2">
                <Trash2 className="w-4 h-4" /> Delete targets
              </button>
            )}
          </div>
          <textarea readOnly value={brief} className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed min-h-[170px]" aria-label="WhatsApp brief" />
        </div>
      )}

      {reviewOpen && (
        <div className="border-t border-gray-100 pt-4 space-y-4">
          <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">After the event</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={labelCls}>Actual total sales (RM)</label>
              <input type="number" min={0} className={inputCls} value={actual} onChange={(e) => setActual(e.target.value)} /></div>
            <div><label className={labelCls}>People who hit Tier 2</label>
              <input type="number" min={0} className={inputCls} value={hits} onChange={(e) => setHits(e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Review notes (crowd, what worked, what to change)</label>
            <textarea className={cn(inputCls, 'min-h-[80px]')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. crowd only came after 4pm, Sat was 2x Fri" /></div>
          <button onClick={saveReview} className="bg-[#FFD700] hover:bg-[#f0cb00] text-gray-900 font-semibold text-sm rounded-lg px-4 py-2">Save review</button>
          {saved?.actual_sales != null && saved.actual_sales > 0 && (
            <div className={cn('rounded-lg px-4 py-3 text-sm', saved.actual_sales >= saved.tier2_total ? 'bg-green-50 text-green-800' : 'bg-orange-50 text-orange-800')}>
              Actual {fmtRM(saved.actual_sales)} = {(saved.actual_sales / saved.tier2_total * 100).toFixed(0)}% of Tier 2 ({fmtRM(saved.tier2_total)}).
              Per person per day: {fmtRM(saved.actual_sales / Math.max(1, saved.pt_days))} vs Tier 2 {fmtRM(saved.per_head_tier2)}.
              {saved.tier2_hits != null && ` ${saved.tier2_hits} crew hit Tier 2.`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
