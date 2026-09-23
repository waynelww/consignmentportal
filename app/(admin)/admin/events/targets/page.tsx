'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Target, Lock, Unlock, Copy, Save, Plus, X, Download, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  calcTargets, defaultWeights, whatsappBrief, fmtRM, DEFAULT_SETTINGS,
  type TargetSettings, type EventLevel, type DayInput,
} from '@/lib/events/target-calc'

interface DayRow { id: string; label: string; crew: number; weight_pct: number }
interface SavedEvent {
  id: string
  name: string
  start_date: string | null
  event_level: EventLevel
  per_head_tier2: number
  rental: number; delivery: number; other_fixed: number; pt_daily_rate: number
  pt_days: number; fixed_cost: number
  tier1_total: number; tier2_total: number; tier3_total: number
  cover_ratio: number
  actual_sales: number | null; tier2_hits: number | null; review_notes: string | null
  locked_at: string | null
  created_at: string
  event_target_days: { label: string; crew: number; weight_pct: number }[]
}

const LEVELS: { key: EventLevel; name: string; desc: string }[] = [
  { key: 'small', name: 'Small', desc: 'Community market, first-time organiser' },
  { key: 'medium', name: 'Medium', desc: 'Mall event, festival, school fest' },
  { key: 'major', name: 'Major', desc: 'Annual crowd-puller (AOS, Boom+, Hausboom)' },
]

let dayIdSeq = 0
const newDay = (label: string, crew: number): DayRow => ({ id: `d${++dayIdSeq}`, label, crew, weight_pct: 0 })
const freshDays = () => {
  const days = [newDay('Fri', 4), newDay('Sat', 5), newDay('Sun', 5)]
  const w = defaultWeights(days.length)
  days.forEach((d, i) => { d.weight_pct = w[i] })
  return days
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400'
const labelCls = 'block text-xs font-medium text-gray-500 mb-1'

export default function EventTargetsPage() {
  const [settings, setSettings] = useState<TargetSettings>(DEFAULT_SETTINGS)
  const [canEditSettings, setCanEditSettings] = useState(false)
  const [saved, setSaved] = useState<SavedEvent[]>([])
  const [loading, setLoading] = useState(true)

  // form
  const [editingId, setEditingId] = useState<string | null>(null)
  const [lockedAt, setLockedAt] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [level, setLevel] = useState<EventLevel>('medium')
  const [perHeadOverride, setPerHeadOverride] = useState('')
  const [rental, setRental] = useState(0)
  const [delivery, setDelivery] = useState(280)
  const [otherFixed, setOtherFixed] = useState(300)
  const [ptRate, setPtRate] = useState(120)
  const [days, setDays] = useState<DayRow[]>(freshDays)
  const [saving, setSaving] = useState(false)

  // review
  const [actual, setActual] = useState('')
  const [hits, setHits] = useState('')
  const [notes, setNotes] = useState('')

  // list filters
  const [filterLevel, setFilterLevel] = useState<'all' | EventLevel>('all')
  const [filterMonth, setFilterMonth] = useState('')

  const [showSettings, setShowSettings] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<TargetSettings>(DEFAULT_SETTINGS)

  const locked = !!lockedAt

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [evRes, sRes] = await Promise.all([
      fetch('/api/event-targets'),
      fetch('/api/event-targets/settings'),
    ])
    const evBody = await evRes.json().catch(() => ({}))
    const sBody = await sRes.json().catch(() => ({}))
    if (evRes.ok) setSaved(evBody.events ?? [])
    if (sRes.ok && sBody.settings) {
      setSettings(sBody.settings)
      setSettingsDraft(sBody.settings)
      setCanEditSettings(!!sBody.can_edit)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const calc = useMemo(() => {
    const dayInputs: DayInput[] = days.map((d) => ({ label: d.label, crew: d.crew || 0, weight_pct: d.weight_pct || 0 }))
    if (!dayInputs.length) return null
    const result = calcTargets({
      level,
      per_head_override: perHeadOverride ? Number(perHeadOverride) : null,
      rental: rental || 0,
      delivery: delivery || 0,
      other_fixed: otherFixed || 0,
      pt_daily_rate: ptRate || 0,
      days: dayInputs,
    }, settings)
    return result.pt_days > 0 && result.per_head_tier2 > 0 ? result : null
  }, [days, level, perHeadOverride, rental, delivery, otherFixed, ptRate, settings])

  const brief = useMemo(() => (calc ? whatsappBrief(name.trim() || 'Event', calc, settings) : ''), [calc, name, settings])

  function setDay(i: number, patch: Partial<DayRow>) {
    setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  }
  function reweight(ds: DayRow[]) {
    const w = defaultWeights(ds.length)
    return ds.map((d, i) => ({ ...d, weight_pct: w[i] }))
  }

  function loadEvent(ev: SavedEvent) {
    setEditingId(ev.id)
    setLockedAt(ev.locked_at)
    setName(ev.name)
    setStartDate(ev.start_date ?? '')
    setLevel(ev.event_level)
    setPerHeadOverride('')
    setRental(Number(ev.rental)); setDelivery(Number(ev.delivery)); setOtherFixed(Number(ev.other_fixed)); setPtRate(Number(ev.pt_daily_rate))
    setDays(ev.event_target_days.map((d) => ({ id: `d${++dayIdSeq}`, label: d.label, crew: Number(d.crew), weight_pct: Number(d.weight_pct) })))
    setActual(ev.actual_sales != null ? String(ev.actual_sales) : '')
    setHits(ev.tier2_hits != null ? String(ev.tier2_hits) : '')
    setNotes(ev.review_notes ?? '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingId(null); setLockedAt(null)
    setName(''); setStartDate(''); setLevel('medium'); setPerHeadOverride('')
    setRental(0); setDelivery(280); setOtherFixed(300); setPtRate(120)
    setDays(freshDays())
    setActual(''); setHits(''); setNotes('')
  }

  function payload() {
    return {
      name: name.trim(),
      start_date: startDate || null,
      event_level: level,
      per_head_override: perHeadOverride ? Number(perHeadOverride) : null,
      rental: rental || 0,
      delivery: delivery || 0,
      other_fixed: otherFixed || 0,
      pt_daily_rate: ptRate || 0,
      days: days.map((d) => ({ label: d.label || 'Day', crew: d.crew || 0, weight_pct: d.weight_pct || 0 })),
    }
  }

  async function save(): Promise<string | null> {
    if (!name.trim()) { toast.error('Give the event a name first'); return null }
    setSaving(true)
    const res = await fetch(editingId ? `/api/event-targets/${editingId}` : '/api/event-targets', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { toast.error(body.error || `Save failed (${res.status})`); return null }
    const id = body.id as string
    setEditingId(id)
    toast.success('Saved')
    fetchAll()
    return id
  }

  async function lockEvent() {
    const id = editingId ?? await save()
    if (!id) return
    const res = await fetch(`/api/event-targets/${id}/lock`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Lock failed'); return }
    setLockedAt(body.locked_at)
    toast.success('Locked — targets are frozen')
    fetchAll()
  }

  async function unlockEvent() {
    if (!editingId) return
    const res = await fetch(`/api/event-targets/${editingId}/lock`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Unlock failed'); return }
    setLockedAt(null)
    toast.success('Unlocked')
    fetchAll()
  }

  async function saveReview() {
    if (!editingId) { toast.error('Save the event first'); return }
    const res = await fetch(`/api/event-targets/${editingId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actual_sales: actual === '' ? null : Number(actual),
        tier2_hits: hits === '' ? null : Number(hits),
        review_notes: notes.trim() || null,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Could not save review'); return }
    toast.success('Review saved')
    fetchAll()
  }

  async function removeEvent(id: string) {
    if (!confirm('Delete this saved event?')) return
    const res = await fetch(`/api/event-targets/${id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Delete failed'); return }
    if (editingId === id) resetForm()
    fetchAll()
  }

  async function saveSettings() {
    const res = await fetch('/api/event-targets/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsDraft),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Could not save settings'); return }
    setSettings(settingsDraft)
    toast.success('Settings saved')
  }

  function copyBrief() {
    navigator.clipboard.writeText(brief)
      .then(() => toast.success('Brief copied — paste into WhatsApp'))
      .catch(() => toast.error('Copy failed — long-press the text below instead'))
  }

  function exportCsv() {
    if (!saved.length) { toast.error('Nothing to export'); return }
    const cols = ['name', 'start_date', 'event_level', 'per_head_tier2', 'rental', 'delivery', 'other_fixed', 'pt_daily_rate', 'pt_days', 'fixed_cost', 'tier1_total', 'tier2_total', 'tier3_total', 'cover_ratio', 'actual_sales', 'tier2_hits', 'review_notes', 'locked_at'] as const
    const csv = [cols.join(',')].concat(saved.map((e) => cols.map((c) => {
      let v = String(e[c] ?? '')
      v = v.replace(/"/g, '""')
      return /[",\n]/.test(v) ? `"${v}"` : v
    }).join(','))).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'xocks-event-targets.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const filtered = saved.filter((e) =>
    (filterLevel === 'all' || e.event_level === filterLevel) &&
    (!filterMonth || (e.start_date ?? '').startsWith(filterMonth)),
  )

  const reviewOpen = editingId && (!startDate || startDate <= new Date().toISOString().slice(0, 10))
  const currentSaved = saved.find((e) => e.id === editingId)

  const flag = useMemo(() => {
    if (!calc) return null
    if (calc.fixed_cost > 0 && calc.cover_ratio < settings.min_cover_ratio) {
      return {
        ok: false,
        text: `Team target (${fmtRM(calc.tier2_total)}) is only ${calc.cover_ratio.toFixed(1)}× the event cost (${fmtRM(calc.fixed_cost)}). Below ${settings.min_cover_ratio}× the event is weak — check the rental or crew size with Wayne before locking.`,
      }
    }
    const t2s = calc.days.filter((d) => d.crew > 0).map((d) => d.per_person_tier2)
    return {
      ok: true,
      text: `Team target covers the event cost ${calc.cover_ratio.toFixed(1)}×, and per-person numbers (${fmtRM(Math.min(...t2s))}–${fmtRM(Math.max(...t2s))} Tier 2) are in the range past events of this level have hit.`,
    }
  }, [calc, settings])

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Target className="w-5 h-5 text-[#B8860B]" /> Event Target Calculator</h2>
          <p className="text-sm text-gray-500">Pick the level, fill in the crew per day — everyone gets their number for each day.</p>
        </div>
        {editingId && (
          <span className={cn('text-xs font-semibold px-3 py-1.5 rounded-full', locked ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600')}>
            {locked ? '🔒 Locked — targets frozen' : 'Editing saved event'}
          </span>
        )}
      </div>

      {/* Event */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Event</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={labelCls}>Event name</label>
            <input className={inputCls} value={name} disabled={locked} onChange={(e) => setName(e.target.value)} placeholder="e.g. BNF 2026" /></div>
          <div><label className={labelCls}>Start date</label>
            <input type="date" className={inputCls} value={startDate} disabled={locked} onChange={(e) => setStartDate(e.target.value)} /></div>
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
      </div>

      {/* Costs and crew */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Costs and crew</h3>
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
              <div><label className={labelCls}>Day</label>
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
          <button type="button" disabled={locked} onClick={() => setDays((ds) => reweight([...ds, newDay(`Day ${ds.length + 1}`, 4)]))}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-2 disabled:opacity-40">
            <Plus className="w-4 h-4" /> Add a day
          </button>
        </div>
        <p className="text-xs text-gray-400">Weight % splits the event across days (3-day auto 25 / 40 / 35, 2-day 55 / 45). Edit if Saturday is the big day.</p>
      </div>

      {/* Results */}
      {calc && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">{name.trim() || 'Event'} — targets</h3>
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
                    <td className="py-2 px-2 font-medium text-gray-900">{d.label}</td>
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

          {flag && (
            <div className={cn('rounded-lg px-4 py-3 text-sm', flag.ok ? 'bg-green-50 text-green-800' : 'bg-orange-50 text-orange-800')}>
              {flag.text}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={copyBrief} className="flex items-center gap-1.5 bg-[#FFD700] hover:bg-[#f0cb00] text-gray-900 font-semibold text-sm rounded-lg px-4 py-2">
              <Copy className="w-4 h-4" /> Copy WhatsApp brief
            </button>
            <button onClick={save} disabled={saving || locked} className="flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save event'}
            </button>
            {!locked && (
              <button onClick={lockEvent} className="flex items-center gap-1.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-sm font-medium rounded-lg px-4 py-2">
                <Lock className="w-4 h-4" /> Lock targets
              </button>
            )}
            {locked && canEditSettings && (
              <button onClick={unlockEvent} className="flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-sm font-medium rounded-lg px-4 py-2">
                <Unlock className="w-4 h-4" /> Unlock (admin)
              </button>
            )}
            <button onClick={resetForm} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2">New event</button>
          </div>

          <textarea readOnly value={brief} className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed min-h-[170px]" aria-label="WhatsApp brief" />
        </div>
      )}

      {/* After the event */}
      {reviewOpen && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">After the event</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={labelCls}>Actual total sales (RM)</label>
              <input type="number" min={0} className={inputCls} value={actual} onChange={(e) => setActual(e.target.value)} /></div>
            <div><label className={labelCls}>People who hit Tier 2</label>
              <input type="number" min={0} className={inputCls} value={hits} onChange={(e) => setHits(e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Review notes (crowd, what worked, what to change)</label>
            <textarea className={cn(inputCls, 'min-h-[80px]')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. crowd only came after 4pm, Sat was 2x Fri" /></div>
          <button onClick={saveReview} className="bg-[#FFD700] hover:bg-[#f0cb00] text-gray-900 font-semibold text-sm rounded-lg px-4 py-2">Save review</button>
          {currentSaved?.actual_sales != null && currentSaved.actual_sales > 0 && (
            <div className={cn('rounded-lg px-4 py-3 text-sm',
              currentSaved.actual_sales >= currentSaved.tier2_total ? 'bg-green-50 text-green-800' : 'bg-orange-50 text-orange-800')}>
              Actual {fmtRM(currentSaved.actual_sales)} = {(currentSaved.actual_sales / currentSaved.tier2_total * 100).toFixed(0)}% of Tier 2 ({fmtRM(currentSaved.tier2_total)}).
              Per person per day: {fmtRM(currentSaved.actual_sales / Math.max(1, currentSaved.pt_days))} vs Tier 2 {fmtRM(currentSaved.per_head_tier2)}.
              {currentSaved.tier2_hits != null && ` ${currentSaved.tier2_hits} crew hit Tier 2.`}
            </div>
          )}
        </div>
      )}

      {/* Settings */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 w-full">
          {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Settings {canEditSettings ? '(admin)' : '(view only — admin can edit)'}
        </button>
        {showSettings && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {([
                ['per_head_small', 'Small level per head (RM)'],
                ['per_head_medium', 'Medium level per head (RM)'],
                ['per_head_major', 'Major level per head (RM)'],
                ['tier1_pct_of_tier2', 'Tier 1 = % of Tier 2'],
                ['tier3_pct_of_tier2', 'Tier 3 = % of Tier 2'],
                ['round_to', 'Round to (RM)'],
                ['bonus_tier1', 'Tier 1 bonus (RM)'],
                ['bonus_tier2', 'Tier 2 bonus (RM)'],
                ['bonus_tier3', 'Tier 3 bonus (RM)'],
                ['avg_sale_per_customer', 'Average sale per customer (RM)'],
                ['min_cover_ratio', 'Min sales ÷ fixed cost before flag'],
              ] as [keyof TargetSettings, string][]).map(([k, label]) => (
                <div key={k}><label className={labelCls}>{label}</label>
                  <input type="number" className={inputCls} disabled={!canEditSettings} value={settingsDraft[k]}
                    onChange={(e) => setSettingsDraft((s) => ({ ...s, [k]: +e.target.value }))} /></div>
              ))}
            </div>
            {canEditSettings && (
              <button onClick={saveSettings} className="bg-[#FFD700] hover:bg-[#f0cb00] text-gray-900 font-semibold text-sm rounded-lg px-4 py-2">Save settings</button>
            )}
          </div>
        )}
      </div>

      {/* Saved events */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Saved events</h3>
          <div className="flex items-center gap-2">
            <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" value={filterLevel} onChange={(e) => setFilterLevel(e.target.value as 'all' | EventLevel)}>
              <option value="all">All levels</option>
              <option value="small">Small</option><option value="medium">Medium</option><option value="major">Major</option>
            </select>
            <input type="month" className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} />
            <button onClick={exportCsv} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : !filtered.length ? (
          <p className="text-sm text-gray-400">No events saved yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((e) => (
              <div key={e.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    {e.name} {e.locked_at && <Lock className="w-3.5 h-3.5 text-amber-600" />}
                  </div>
                  <div className="text-xs text-gray-500">
                    {e.start_date ?? 'no date'} · {e.event_level} · T2 {fmtRM(e.tier2_total)}
                    {e.actual_sales != null && e.actual_sales > 0
                      ? ` · actual ${fmtRM(e.actual_sales)} (${(e.actual_sales / e.tier2_total * 100).toFixed(0)}% of T2${e.tier2_hits != null ? `, ${e.tier2_hits} hit T2` : ''})`
                      : ' · no review yet'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => loadEvent(e)} className="text-xs font-medium border border-gray-200 hover:bg-gray-50 rounded-lg px-3 py-1.5">Open</button>
                  <button onClick={() => removeEvent(e.id)} className="text-xs text-gray-400 hover:text-red-500 px-1"><X className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
