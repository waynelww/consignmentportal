'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calculator, History, Info, Loader2, RotateCcw, Settings2, Truck, X } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn, formatMYDate } from '@/lib/utils'
import {
  DEFAULT_PERIOD_MONTHS, PERIOD_MONTH_OPTIONS, WAYNE_SETTING_KEYS,
  describePeriod, formatDateRange, isPeriodMonths, parseWayneSettings,
  type PeriodMonths, type WayneResult, type WayneSettings, type StoreStatus,
} from '@/lib/restock/wayne-calc'

// Restock Calculator — Wayne's consignment restock method, one store at a
// time. All maths runs server-side via lib/restock/wayne-calc.ts; this page
// only displays it. Nothing is saved until "Save calculation" or "Create
// restock request".

interface StoreOption { id: string; store_code: string; store_name: string }

interface SavedCalc {
  id: string
  store_id: string
  period_start: string
  period_end: string
  settings: { period?: { months_chosen?: number; months_covered?: number | null; short_history?: boolean } } | null
  status: StoreStatus
  pairs_per_month: number | null
  target_stock: number | null
  pairs_to_send: number | null
  final_total: number | null
  edited_sends: Record<string, number> | null
  restock_request_id: string | null
  calculated_by_name: string | null
  calculated_at: string
  voided_at: string | null
  void_reason: string | null
}

const INPUT = 'px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]'
const CARD = 'bg-white rounded-xl shadow-sm border border-[#E5E7EB]'
const PRIMARY = 'flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#FFD700] text-black hover:bg-[#F0CB00] disabled:opacity-50 transition-colors'
const SECONDARY = 'flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#E5E7EB] text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors'

// Same pills as Stores > Inventory (OK / Low / Out)
const PILL: Record<StoreStatus, { label: string; cls: string }> = {
  restock_now: { label: 'Restock now', cls: 'bg-red-100 text-red-700' },
  stock_ok: { label: 'Stock OK', cls: 'bg-green-100 text-green-700' },
  not_enough_history: { label: 'Not enough history', cls: 'bg-amber-100 text-amber-700' },
}
function StatusPill({ status }: { status: StoreStatus }) {
  return <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', PILL[status].cls)}>{PILL[status].label}</span>
}
function SkuPill({ onHand, send }: { onHand: number; send: number }) {
  const s = onHand === 0 ? 'Out' : send > 0 ? 'Low' : 'OK'
  const cls = s === 'Out' ? 'bg-red-100 text-red-700' : s === 'Low' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
  return <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', cls)}>{s}</span>
}

const SETTING_LABELS: Record<keyof WayneSettings, string> = {
  price_plain: 'Plain price (RM/pair)',
  price_special: 'Special Patches price (RM/pair)',
  special_min_selling_price: 'Special if selling price ≥ (RM)',
  target_multiplier: 'Target = pairs/month ×',
  trigger_multiplier: 'Trigger = pairs/month ×',
  consistency_pct: 'Consistency flag (± %)',
  stale_sale_days: 'Warn if last sale older than (days)',
}

// Last 2/3-month choice, remembered per user in this browser
const monthsKey = (userId: string) => `xcms.restockCalc.months.${userId}`
function readMonths(userId: string): PeriodMonths | null {
  try {
    const v = Number(window.localStorage.getItem(monthsKey(userId)))
    return isPeriodMonths(v) ? v : null
  } catch { return null }
}
function writeMonths(userId: string, m: PeriodMonths) {
  try { window.localStorage.setItem(monthsKey(userId), String(m)) } catch { /* storage unavailable */ }
}

export default function RestockCalculatorPage() {
  const [stores, setStores] = useState<StoreOption[]>([])
  const [settings, setSettings] = useState<WayneSettings | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [storeId, setStoreId] = useState('')
  const [months, setMonths] = useState<PeriodMonths>(DEFAULT_PERIOD_MONTHS)

  // The selected store's calculation; calcId is set once this view is saved.
  const [detail, setDetail] = useState<{ calcId: string | null; result: WayneResult; linkedRequest: string | null } | null>(null)
  const [savedSends, setSavedSends] = useState<Record<string, number> | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [sends, setSends] = useState<Record<string, number>>({})
  const [history, setHistory] = useState<SavedCalc[]>([])

  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | 'clear' | 'request'>(null)
  const [voidTarget, setVoidTarget] = useState<SavedCalc | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({})

  const loadSettings = useCallback(async () => {
    const res = await fetch('/api/settings')
    const data = await res.json().catch(() => [])
    if (res.ok && Array.isArray(data)) setSettings(parseWayneSettings(data))
  }, [])

  useEffect(() => {
    fetch('/api/restock/calculator')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || 'Failed to load stores'); return }
        setStores(data.stores ?? [])
      })
      .catch(() => toast.error('Failed to load stores'))
    loadSettings()
    createClient().auth.getUser().then((res: { data: { user: { id: string } | null } }) => {
      const id = res.data.user?.id
      if (!id) return
      setUserId(id)
      const saved = readMonths(id)
      if (saved) setMonths(saved)
    })
  }, [loadSettings])

  const loadHistory = useCallback(async (sid: string) => {
    const res = await fetch(`/api/restock/calculator/history?store_id=${sid}&limit=20`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) setHistory(data.calculations ?? [])
  }, [])

  // Calculate (never saves) whenever the store or the 2/3-month choice changes
  const openStore = useCallback(async (sid: string, m: PeriodMonths) => {
    if (!sid) { setDetail(null); setHistory([]); return }
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/restock/calculator?store_id=${sid}&months=${m}`)
      const data = await res.json().catch(() => ({}))
      const result = (data.result ?? null) as WayneResult | null
      if (!res.ok || !result) { toast.error(data.error || 'Calculation failed'); setDetail(null); return }
      setDetail({ calcId: null, result, linkedRequest: null })
      setSavedSends(null)
      setSends(Object.fromEntries(result.skus.map((s) => [s.product_id, s.send])))
      if (data.settings) setSettings(data.settings as WayneSettings)
      loadHistory(sid)
    } catch {
      toast.error('Calculation failed')
    } finally {
      setDetailLoading(false)
    }
  }, [loadHistory])

  useEffect(() => { openStore(storeId, months) }, [storeId, months, openStore])

  function chooseMonths(m: PeriodMonths) {
    setMonths(m)
    if (userId) writeMonths(userId, m)
  }

  const finalTotal = useMemo(
    () => (detail?.result.skus ?? []).reduce((a, s) => a + (sends[s.product_id] ?? 0), 0),
    [detail, sends],
  )
  const edited = useMemo(
    () => (detail?.result.skus ?? []).some((s) => (sends[s.product_id] ?? 0) !== s.send),
    [detail, sends],
  )
  // unsaved = never saved, or Send numbers changed since the last save
  const unsaved = useMemo(
    () => !detail?.calcId || !savedSends || (detail?.result.skus ?? []).some((s) => (sends[s.product_id] ?? 0) !== (savedSends[s.product_id] ?? 0)),
    [detail, sends, savedSends],
  )

  function clearAll() {
    setStoreId('')
    setDetail(null)
    setSends({})
    setSavedSends(null)
    setHistory([])
    setShowSettings(false)
    setConfirm(null)
    toast.success('Calculator cleared')
  }

  // Saves the current view (with the current Send numbers) and returns its
  // id. First save inserts a new record; later saves of the same view only
  // update its edited Send numbers.
  async function saveCalculation(): Promise<string | null> {
    if (!detail) return null
    if (detail.calcId && !unsaved) return detail.calcId
    const res = detail.calcId
      ? await fetch(`/api/restock/calculator/${detail.calcId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edited_sends: sends }),
        })
      : await fetch('/api/restock/calculator', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store_id: detail.result.store_id, months: detail.result.period.months_chosen, edited_sends: sends }),
        })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error || 'Failed to save calculation'); return null }
    const id = data.calculation.id as string
    setDetail((d) => (d ? { ...d, calcId: id } : d))
    setSavedSends({ ...sends })
    loadHistory(detail.result.store_id)
    return id
  }

  async function handleSave() {
    setBusy(true)
    try {
      if (await saveCalculation()) toast.success('Calculation saved')
    } finally { setBusy(false) }
  }

  // Uses the existing restock flow: creates a pending restock request in the
  // Restock Queue; approving it there creates the delivery order.
  async function createRequest() {
    if (!detail) return
    const items = detail.result.skus
      .map((s) => ({ product_id: s.product_id, quantity_requested: sends[s.product_id] ?? 0 }))
      .filter((i) => i.quantity_requested > 0)
    if (items.length === 0) { toast.error('Nothing to send'); setConfirm(null); return }
    setBusy(true)
    try {
      // Always saved first, so the request is linked to a recorded calculation
      const calcId = await saveCalculation()
      if (!calcId) return
      const p = detail.result.period
      const res = await fetch('/api/restock/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: detail.result.store_id,
          items,
          notes: `Restock Calculator ${p.start && p.end ? formatDateRange(p.start, p.end) : ''} (calc ${calcId.slice(0, 8)})`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to create restock request'); return }
      const link = await fetch(`/api/restock/calculator/${calcId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restock_request_id: data.request_id }),
      })
      if (!link.ok) toast.error('Request created, but linking it to this calculation failed')
      setDetail((d) => (d ? { ...d, calcId, linkedRequest: data.request_id } : d))
      toast.success('Restock request created — approve it in the Restock Queue to raise the DO')
      loadHistory(storeId)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function submitVoid() {
    if (!voidTarget) return
    setBusy(true)
    try {
      const res = await fetch(`/api/restock/calculator/${voidTarget.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to void'); return }
      toast.success('Calculation voided')
      if (detail?.calcId === voidTarget.id) {
        setDetail((d) => (d ? { ...d, calcId: null, linkedRequest: null } : d))
        setSavedSends(null)
      }
      setVoidTarget(null)
      setVoidReason('')
      loadHistory(storeId)
    } finally { setBusy(false) }
  }

  function openSettings() {
    if (!settings) return
    setSettingsDraft(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)])))
    setShowSettings(true)
  }

  async function saveSettings() {
    const updates = (Object.keys(WAYNE_SETTING_KEYS) as (keyof WayneSettings)[]).map((k) => ({
      key: WAYNE_SETTING_KEYS[k], value: (settingsDraft[k] ?? '').trim(),
    }))
    if (updates.some((u) => !(Number(u.value) > 0))) { toast.error('All settings must be numbers above 0'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to save settings'); return }
      toast.success('Settings saved')
      setShowSettings(false)
      await loadSettings()
      if (storeId) openStore(storeId, months)
    } finally { setBusy(false) }
  }

  const r = detail?.result
  const periodText = r ? describePeriod(r.period) : null

  return (
    <div className="-m-6 p-6 min-h-full bg-[#F8F8F8] space-y-5">
      {/* Controls */}
      <div className={cn(CARD, 'p-4')}>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Store</label>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={cn(INPUT, 'min-w-[240px]')}>
              <option value="">Select a store…</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Period (ending on last recorded sale)</label>
            <div className="flex gap-2">
              {PERIOD_MONTH_OPTIONS.map((m) => (
                <button key={m} onClick={() => chooseMonths(m)}
                  className={cn('px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                    months === m ? 'bg-[#FFD700] text-black border-[#FFD700] hover:bg-[#F0CB00]' : 'bg-white text-gray-600 border-[#E5E7EB] hover:bg-gray-50')}>
                  {m} months
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={openSettings} disabled={!settings} className={SECONDARY}>
              <Settings2 size={15} /> Settings
            </button>
            <button onClick={() => setConfirm('clear')} className={SECONDARY}>
              <RotateCcw size={15} /> Clear all
            </button>
          </div>
        </div>
        {settings && (
          <p className="text-xs text-gray-500 mt-3">
            Pairs = sales ÷ RM{settings.price_plain} (Plain) or RM{settings.price_special} (Special Patches, selling price ≥ RM{settings.special_min_selling_price}).
            Pairs/month = pairs in the period ÷ months covered. Target = pairs/month × {settings.target_multiplier}, trigger = × {settings.trigger_multiplier}.
          </p>
        )}
      </div>

      {/* Settings */}
      {showSettings && (
        <div className={cn(CARD, 'p-5')}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Calculator settings</h2>
            <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(Object.keys(SETTING_LABELS) as (keyof WayneSettings)[]).map((k) => (
              <div key={k}>
                <label className="text-xs text-gray-500 block mb-1">{SETTING_LABELS[k]}</label>
                <input type="number" min="0" step="any" value={settingsDraft[k] ?? ''}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, [k]: e.target.value }))}
                  className={cn(INPUT, 'w-full')} />
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={saveSettings} disabled={busy} className={PRIMARY}>
              {busy && <Loader2 size={14} className="animate-spin" />} Save settings
            </button>
          </div>
        </div>
      )}

      {!storeId && (
        <div className={cn(CARD, 'p-10 text-center')}>
          <Calculator size={22} className="inline text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">Select a store to calculate its restock.</p>
          <p className="text-xs text-gray-400 mt-1">Nothing is saved until you click Save calculation or Create restock request.</p>
        </div>
      )}

      {/* Store breakdown */}
      {storeId && (
        <div className={cn(CARD, 'p-5 space-y-4')}>
          {detailLoading || !r ? (
            <div className="py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">{r.store_name}</h2>
                    <StatusPill status={r.status} />
                  </div>
                  {periodText && <p className="text-sm text-gray-700 mt-0.5">{periodText}</p>}
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.store_code} ·{' '}
                    {detail?.calcId
                      ? <>saved as calc {detail.calcId.slice(0, 8)}{unsaved && ' (unsaved changes)'}</>
                      : 'not saved'}
                  </p>
                </div>
                <button onClick={() => setStoreId('')} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>

              {r.stale_sales && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  {r.last_sale_date
                    ? `Last recorded sale was ${formatMYDate(r.last_sale_date)} (${r.days_since_last_sale} days ago). The period ends on that date, so sales the store hasn't entered yet are not counted.`
                    : 'This store has no recorded sales.'}
                </div>
              )}

              {r.status === 'not_enough_history' ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">Less than 1 month of sales — start with 30–50 pairs.</p>
                  <p className="mt-1">
                    {r.first_sale_date && r.last_sale_date
                      ? `Sales recorded from ${formatMYDate(r.first_sale_date)} to ${formatMYDate(r.last_sale_date)}.`
                      : 'No sales recorded yet.'} No calculation is made until the store has at least 1 month of sales.
                  </p>
                  <div className="flex justify-end mt-3">
                    <button onClick={handleSave} disabled={busy || !unsaved} className={SECONDARY}>
                      {unsaved ? 'Save calculation' : 'Saved'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {r.period.short_history && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                      Only {r.period.months_covered?.toFixed(1)} months of sales history, so the average is based on less than the chosen period.
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      ['Pairs / month', r.pairs_per_month],
                      ['Target stock', r.target_stock],
                      ['Restock trigger', r.restock_trigger],
                      ['On hand', r.on_hand],
                      ['Pairs to send', finalTotal],
                    ].map(([label, v]) => (
                      <div key={label as string} className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-xl font-bold text-gray-900">{v ?? '—'}</p>
                      </div>
                    ))}
                  </div>

                  {/* One-month blocks ending on the last sale */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Month block</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Sales (RM)</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Pairs</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">vs average</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.months.map((m) => (
                          <tr key={m.start} className="border-b border-gray-50">
                            <td className="py-2 px-3">
                              {formatDateRange(m.start, m.end)}
                              {m.partial && <span className="text-xs text-gray-400"> · partial (before first sale)</span>}
                            </td>
                            <td className="py-2 px-3 text-right">{m.sales_amount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">{m.pairs.toFixed(1)}</td>
                            <td className="py-2 px-3 text-right">
                              {m.deviation_pct === null ? '—' : (
                                <span className={cn(m.flagged ? 'px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700' : 'text-gray-500')}>
                                  {m.deviation_pct > 0 ? '+' : ''}{m.deviation_pct}%
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {r.consistency_flag && (
                      <p className="text-xs text-amber-700 mt-2">
                        Sales are uneven: at least one month is more than {settings?.consistency_pct ?? 20}% away from the average. Check before sending.
                      </p>
                    )}
                  </div>

                  {/* SKUs */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Product</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">SKU</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Sold (pairs)</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Share</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">SKU target</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">On hand</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Status</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Send</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.skus.map((s) => {
                          const v = sends[s.product_id] ?? 0
                          return (
                            <tr key={s.product_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                              <td className="py-2 px-3 font-medium text-gray-800">{s.name}</td>
                              <td className="py-2 px-3 font-mono text-xs text-gray-500">{s.sku || '—'}</td>
                              <td className="py-2 px-3 text-right">{s.pairs_sold}</td>
                              <td className="py-2 px-3 text-right text-gray-500">{(s.share * 100).toFixed(1)}%</td>
                              <td className="py-2 px-3 text-right">{s.sku_target}</td>
                              <td className="py-2 px-3 text-right font-semibold">{s.on_hand}</td>
                              <td className="py-2 px-3"><SkuPill onHand={s.on_hand} send={s.send} /></td>
                              <td className="py-2 px-3 text-right">
                                <input type="number" min="0" step="1" value={v}
                                  disabled={!!detail?.linkedRequest}
                                  onChange={(e) => setSends((p) => ({ ...p, [s.product_id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                                  className={cn(INPUT, 'w-20 text-right py-1', v !== s.send && 'ring-2 ring-[#FFD700]')} />
                              </td>
                            </tr>
                          )
                        })}
                        {r.skus.length === 0 && (
                          <tr><td colSpan={8} className="py-6 text-center text-gray-400 text-sm">This store has no products in its inventory</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {r.sold_not_in_inventory.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg bg-gray-50 border border-[#E5E7EB] px-3 py-2 text-xs text-gray-600">
                      <Info size={14} className="mt-0.5 flex-shrink-0" />
                      <div>
                        Sold in this period but no longer in the store&apos;s inventory (not restocked):{' '}
                        {r.sold_not_in_inventory.map((x) => `${x.name} (${x.pairs_sold})`).join(', ')}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-sm text-gray-600 mr-auto">
                      Total to send: <span className="font-semibold text-gray-900">{finalTotal}</span> pairs
                      {edited && <span className="text-xs text-gray-400"> (calculated {r.pairs_to_send})</span>}
                    </span>
                    {detail?.linkedRequest ? (
                      <Link href="/admin/restocks" className={PRIMARY}>
                        <Truck size={15} /> Open Restock Queue
                      </Link>
                    ) : (
                      <>
                        <button onClick={handleSave} disabled={busy || !unsaved} className={SECONDARY}>
                          {unsaved ? 'Save calculation' : 'Saved'}
                        </button>
                        <button onClick={() => setConfirm('request')} disabled={busy || finalTotal === 0} className={PRIMARY}>
                          <Truck size={15} /> Create restock request
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Saved calculations for this store */}
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-2"><History size={15} /> Saved calculations</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left py-2 px-3 font-semibold text-gray-500">When</th>
                        <th className="text-left py-2 px-3 font-semibold text-gray-500">By</th>
                        <th className="text-left py-2 px-3 font-semibold text-gray-500">Period</th>
                        <th className="text-left py-2 px-3 font-semibold text-gray-500">Status</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-500">Calc / final send</th>
                        <th className="text-left py-2 px-3 font-semibold text-gray-500">Request</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-500"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => {
                        const hp = h.settings?.period
                        return (
                          <tr key={h.id} className={cn('border-b border-gray-50', h.voided_at && 'text-gray-400 line-through')}>
                            <td className="py-2 px-3">{new Date(h.calculated_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</td>
                            <td className="py-2 px-3">{h.calculated_by_name || '—'}</td>
                            <td className="py-2 px-3">
                              {formatDateRange(h.period_start, h.period_end)}
                              {hp?.months_chosen && <span className="text-gray-400"> · {hp.months_chosen} mo{hp.short_history && hp.months_covered ? ` (${hp.months_covered.toFixed(1)} covered)` : ''}</span>}
                            </td>
                            <td className="py-2 px-3">{PILL[h.status].label}</td>
                            <td className="py-2 px-3 text-right">{h.pairs_to_send ?? '—'} / {h.final_total ?? '—'}{h.edited_sends && ' (edited)'}</td>
                            <td className="py-2 px-3">{h.restock_request_id ? h.restock_request_id.slice(0, 8) : '—'}</td>
                            <td className="py-2 px-3 text-right no-underline">
                              {h.voided_at
                                ? <span className="no-underline" title={h.void_reason ?? ''}>Voided</span>
                                : <button onClick={() => { setVoidTarget(h); setVoidReason('') }} className="text-gray-500 hover:text-gray-900 underline">Void</button>}
                            </td>
                          </tr>
                        )
                      })}
                      {history.length === 0 && (
                        <tr><td colSpan={7} className="py-4 text-center text-gray-400">No saved calculations</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Confirm modal (clear / create request) */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h2 className="font-semibold text-gray-900 mb-2">
              {confirm === 'clear' ? 'Clear all?' : 'Create restock request?'}
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {confirm === 'clear'
                ? 'This clears the selected store and any unsaved Send numbers on this page. Saved calculations stay in history.'
                : `Saves this calculation and creates a linked pending restock request for ${r?.store_name} with ${finalTotal} pairs. Approve it in the Restock Queue to create the delivery order.`}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirm(null)} disabled={busy} className={cn(SECONDARY, 'flex-1')}>Cancel</button>
              <button onClick={confirm === 'clear' ? clearAll : createRequest} disabled={busy} className={cn(PRIMARY, 'flex-1')}>
                {busy && <Loader2 size={14} className="animate-spin" />}
                {confirm === 'clear' ? 'Clear all' : 'Create request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void modal */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h2 className="font-semibold text-gray-900 mb-2">Void calculation?</h2>
            <p className="text-sm text-gray-600 mb-3">The record is kept in history and marked void. Please give a reason.</p>
            <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3}
              className={cn(INPUT, 'w-full resize-none')} placeholder="Reason" />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setVoidTarget(null)} disabled={busy} className={cn(SECONDARY, 'flex-1')}>Cancel</button>
              <button onClick={submitVoid} disabled={busy || voidReason.trim().length < 3} className={cn(PRIMARY, 'flex-1')}>Void</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
