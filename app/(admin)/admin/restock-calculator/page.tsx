'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calculator, History, Info, Loader2, RotateCcw, Settings2, Truck, X } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { cn, formatMYDate } from '@/lib/utils'
import {
  addMonths, defaultEndMonth, malaysiaToday, periodFor, WAYNE_SETTING_KEYS,
  type WayneResult, type WayneSettings, type StoreStatus,
} from '@/lib/restock/wayne-calc'

// Restock Calculator — Wayne's consignment restock method. All maths runs
// server-side via lib/restock/wayne-calc.ts; this page only displays it.

interface CalcRun {
  today: string
  end_month: string
  settings: WayneSettings
  stores: WayneResult[]
}

interface SavedCalc {
  id: string
  store_id: string
  end_month: string
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

type StatusFilter = 'all' | StoreStatus

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const periodLabel = (end: string) => {
  const p = periodFor(end).months
  return `${monthLabel(p[0])} – ${monthLabel(p[2])}`
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

export default function RestockCalculatorPage() {
  const today = useMemo(() => malaysiaToday(), [])
  const defaultEnd = useMemo(() => defaultEndMonth(today), [today])
  const endOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(defaultEnd, -i)), [defaultEnd])

  const [endMonth, setEndMonth] = useState(defaultEnd)
  const [storeId, setStoreId] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [run, setRun] = useState<CalcRun | null>(null)
  const [loading, setLoading] = useState(true)

  // Detail (one store) — saved on open
  const [detail, setDetail] = useState<{ calcId: string; result: WayneResult; linkedRequest: string | null } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [sends, setSends] = useState<Record<string, number>>({})
  const [history, setHistory] = useState<SavedCalc[]>([])

  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | 'clear' | 'request'>(null)
  const [voidTarget, setVoidTarget] = useState<SavedCalc | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({})

  const loadOverview = useCallback(async (end: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/restock/calculator?end_month=${end}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to load calculator'); setRun(null); return }
      setRun(data as CalcRun)
    } catch {
      toast.error('Failed to load calculator')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async (sid: string) => {
    const res = await fetch(`/api/restock/calculator/history?store_id=${sid}&limit=20`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) setHistory(data.calculations ?? [])
  }, [])

  const openStore = useCallback(async (sid: string, end: string) => {
    if (!sid) { setDetail(null); setHistory([]); return }
    setDetailLoading(true)
    try {
      const res = await fetch('/api/restock/calculator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: sid, end_month: end }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Calculation failed'); setDetail(null); return }
      const result = data.result as WayneResult
      setDetail({ calcId: data.calculation.id, result, linkedRequest: null })
      setSends(Object.fromEntries(result.skus.map((s) => [s.product_id, s.send])))
      loadHistory(sid)
    } catch {
      toast.error('Calculation failed')
    } finally {
      setDetailLoading(false)
    }
  }, [loadHistory])

  useEffect(() => { loadOverview(endMonth) }, [endMonth, loadOverview])
  useEffect(() => { openStore(storeId, endMonth) }, [storeId, endMonth, openStore])

  const rows = useMemo(() => (run?.stores ?? []).filter((s) => filter === 'all' || s.status === filter), [run, filter])
  const counts = useMemo(() => {
    const c = { all: 0, restock_now: 0, stock_ok: 0, not_enough_history: 0 }
    for (const s of run?.stores ?? []) { c.all++; c[s.status]++ }
    return c
  }, [run])

  const finalTotal = useMemo(
    () => (detail?.result.skus ?? []).reduce((a, s) => a + (sends[s.product_id] ?? 0), 0),
    [detail, sends],
  )
  const edited = useMemo(
    () => (detail?.result.skus ?? []).some((s) => (sends[s.product_id] ?? 0) !== s.send),
    [detail, sends],
  )

  function clearAll() {
    setEndMonth(defaultEnd)
    setStoreId('')
    setFilter('all')
    setDetail(null)
    setSends({})
    setHistory([])
    setShowSettings(false)
    setConfirm(null)
    toast.success('Calculator cleared')
  }

  async function saveEdits(): Promise<boolean> {
    if (!detail) return false
    const res = await fetch(`/api/restock/calculator/${detail.calcId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edited_sends: sends }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error || 'Failed to save edits'); return false }
    return true
  }

  async function handleSaveEdits() {
    setBusy(true)
    try {
      if (await saveEdits()) { toast.success('Send numbers saved'); loadHistory(storeId) }
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
      if (!(await saveEdits())) return
      const res = await fetch('/api/restock/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: detail.result.store_id,
          items,
          notes: `Restock Calculator ${periodLabel(detail.result.period.end_month)} (calc ${detail.calcId.slice(0, 8)})`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to create restock request'); return }
      const link = await fetch(`/api/restock/calculator/${detail.calcId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restock_request_id: data.request_id }),
      })
      if (!link.ok) toast.error('Request created, but linking it to this calculation failed')
      setDetail({ ...detail, linkedRequest: data.request_id })
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
      setVoidTarget(null)
      setVoidReason('')
      loadHistory(storeId)
    } finally { setBusy(false) }
  }

  function openSettings() {
    if (!run) return
    setSettingsDraft(Object.fromEntries(Object.entries(run.settings).map(([k, v]) => [k, String(v)])))
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
      await loadOverview(endMonth)
      if (storeId) openStore(storeId, endMonth)
    } finally { setBusy(false) }
  }

  const r = detail?.result

  return (
    <div className="-m-6 p-6 min-h-full bg-[#F8F8F8] space-y-5">
      {/* Controls */}
      <div className={cn(CARD, 'p-4')}>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Store</label>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={cn(INPUT, 'min-w-[220px]')}>
              <option value="">All stores (overview)</option>
              {(run?.stores ?? []).map((s) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Period (3 complete months)</label>
            <select value={endMonth} onChange={(e) => setEndMonth(e.target.value)} className={INPUT}>
              {endOptions.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={openSettings} disabled={!run} className={SECONDARY}>
              <Settings2 size={15} /> Settings
            </button>
            <button onClick={() => setConfirm('clear')} className={SECONDARY}>
              <RotateCcw size={15} /> Clear all
            </button>
          </div>
        </div>
        {run && (
          <p className="text-xs text-gray-500 mt-3">
            Pairs = sales ÷ RM{run.settings.price_plain} (Plain) or RM{run.settings.price_special} (Special Patches, selling price ≥ RM{run.settings.special_min_selling_price}).
            Target = pairs/month × {run.settings.target_multiplier}, trigger = × {run.settings.trigger_multiplier}.
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

      {/* Overview */}
      <div className={cn(CARD, 'overflow-hidden')}>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#E5E7EB]">
          <h2 className="font-semibold text-gray-900 mr-2">All stores · {periodLabel(endMonth)}</h2>
          {([
            ['all', 'All'], ['restock_now', 'Restock now'], ['stock_ok', 'Stock OK'], ['not_enough_history', 'Not enough history'],
          ] as [StatusFilter, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={cn('px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                filter === k ? 'bg-[#FFD700] text-black border-[#FFD700] hover:bg-[#F0CB00]' : 'bg-white text-gray-600 border-[#E5E7EB] hover:bg-gray-50')}>
              {label} ({counts[k]})
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Store</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Pairs/month</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Target</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Trigger</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">On hand</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Pairs to send</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Consistency</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Last sale</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></td></tr>
              )}
              {!loading && rows.map((s) => (
                <tr key={s.store_id} onClick={() => setStoreId(s.store_id)}
                  className={cn('border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer', storeId === s.store_id && 'bg-amber-50/50')}>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-gray-800">{s.store_name}</div>
                    <div className="text-xs text-gray-400 font-mono">{s.store_code}</div>
                  </td>
                  <td className="py-2.5 px-3"><StatusPill status={s.status} /></td>
                  <td className="py-2.5 px-3 text-right">{s.pairs_per_month ?? '—'}</td>
                  <td className="py-2.5 px-3 text-right">{s.target_stock ?? '—'}</td>
                  <td className="py-2.5 px-3 text-right">{s.restock_trigger ?? '—'}</td>
                  <td className="py-2.5 px-3 text-right font-semibold">{s.on_hand}</td>
                  <td className="py-2.5 px-3 text-right font-semibold">{s.pairs_to_send ?? '—'}</td>
                  <td className="py-2.5 px-3">
                    {s.status === 'not_enough_history' ? <span className="text-gray-300">—</span>
                      : s.consistency_flag ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Uneven</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Steady</span>}
                  </td>
                  <td className="py-2.5 px-3 text-xs">
                    {s.last_sale_date ? (
                      <span className={cn(s.stale_sales ? 'text-amber-700 font-medium' : 'text-gray-500')}>
                        {formatMYDate(s.last_sale_date)}{s.stale_sales && ` · ${s.days_since_last_sale}d ago`}
                      </span>
                    ) : <span className="text-gray-300">No sales</span>}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-gray-400 text-sm">No stores</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.store_code} · {periodLabel(r.period.end_month)} · saved as calc {detail!.calcId.slice(0, 8)}
                  </p>
                </div>
                <button onClick={() => setStoreId('')} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>

              {r.stale_sales && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  {r.last_sale_date
                    ? `Last recorded sale was ${formatMYDate(r.last_sale_date)} (${r.days_since_last_sale} days ago). The store may not have entered its latest sales yet.`
                    : 'This store has no recorded sales.'}
                </div>
              )}

              {r.status === 'not_enough_history' ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">Not enough history — start with 30–50 pairs.</p>
                  <p className="mt-1">
                    {r.first_sale_date
                      ? `First sale was ${formatMYDate(r.first_sale_date)}, after ${monthLabel(r.period.months[0])}.`
                      : 'No sales recorded yet.'} No calculation is made until the store has a full 3 months.
                  </p>
                </div>
              ) : (
                <>
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

                  {/* Months */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Month</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Sales (RM)</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Pairs</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">vs average</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.months.map((m) => (
                          <tr key={m.month} className="border-b border-gray-50">
                            <td className="py-2 px-3">{monthLabel(m.month)}</td>
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
                        Sales are uneven: at least one month is more than {run?.settings.consistency_pct ?? 20}% away from the average. Check before sending.
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
                        <button onClick={handleSaveEdits} disabled={busy || !edited} className={SECONDARY}>Save Send numbers</button>
                        <button onClick={() => setConfirm('request')} disabled={busy || finalTotal === 0} className={PRIMARY}>
                          <Truck size={15} /> Create restock request
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* History */}
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
                      {history.map((h) => (
                        <tr key={h.id} className={cn('border-b border-gray-50', h.voided_at && 'text-gray-400 line-through')}>
                          <td className="py-2 px-3">{new Date(h.calculated_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</td>
                          <td className="py-2 px-3">{h.calculated_by_name || '—'}</td>
                          <td className="py-2 px-3">{periodLabel(h.end_month)}</td>
                          <td className="py-2 px-3">{PILL[h.status].label}</td>
                          <td className="py-2 px-3 text-right">{h.pairs_to_send ?? '—'} / {h.final_total ?? '—'}{h.edited_sends && ' (edited)'}</td>
                          <td className="py-2 px-3">{h.restock_request_id ? h.restock_request_id.slice(0, 8) : '—'}</td>
                          <td className="py-2 px-3 text-right no-underline">
                            {h.voided_at
                              ? <span className="no-underline" title={h.void_reason ?? ''}>Voided</span>
                              : <button onClick={() => { setVoidTarget(h); setVoidReason('') }} className="text-gray-500 hover:text-gray-900 underline">Void</button>}
                          </td>
                        </tr>
                      ))}
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

      {!storeId && !loading && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500"><Calculator size={13} /> Click a store (or pick one above) to see the per-SKU breakdown. Opening a store saves the calculation to history.</p>
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
                ? 'This resets the store, period, filters and any unsaved Send numbers on this page. Saved calculations stay in history.'
                : `Creates a pending restock request for ${r?.store_name} with ${finalTotal} pairs. Approve it in the Restock Queue to create the delivery order.`}
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
