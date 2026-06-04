'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calculator, RotateCcw, Settings2, ChevronDown, ChevronUp } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'

type Length = 'half' | 'crew'
type Sides = 1 | 2
type LogosPerSide = 1 | 2

type VariantKey = string // `${sides}s-${logos}l-${length}`
type PriceGrid = Record<VariantKey, Record<number, number>>

const QTY_TIERS = [15, 30, 50, 100, 500, 1000] as const

// Defaults from the price sheet (crew, 1 side, 1 vs 2 logos). The rest start blank
// for the team to fill in once those tiers are finalised.
const DEFAULT_PRICES: PriceGrid = {
  '1s-1l-crew': { 15: 14, 30: 19, 50: 19, 100: 15, 500: 12, 1000: 10 },
  '1s-2l-crew': { 15: 18, 30: 23, 50: 23, 100: 19, 500: 16, 1000: 14 },
  '1s-1l-half': { 15: 0, 30: 0, 50: 0, 100: 0, 500: 0, 1000: 0 },
  '1s-2l-half': { 15: 0, 30: 0, 50: 0, 100: 0, 500: 0, 1000: 0 },
  '2s-1l-crew': { 15: 0, 30: 0, 50: 0, 100: 0, 500: 0, 1000: 0 },
  '2s-2l-crew': { 15: 0, 30: 0, 50: 0, 100: 0, 500: 0, 1000: 0 },
  '2s-1l-half': { 15: 0, 30: 0, 50: 0, 100: 0, 500: 0, 1000: 0 },
  '2s-2l-half': { 15: 0, 30: 0, 50: 0, 100: 0, 500: 0, 1000: 0 },
}

type TimeConfig = {
  secPerPrint: number
  secClipPerPair: number
  secPackPerPair: number
}
const DEFAULT_TIMES: TimeConfig = { secPerPrint: 45, secClipPerPair: 20, secPackPerPair: 15 }

const PRICE_KEY = 'xcms-oem-calc-prices-v1'
const TIME_KEY = 'xcms-oem-calc-times-v1'

const VARIANT_LABELS: { key: VariantKey; label: string }[] = [
  { key: '1s-1l-crew', label: '1 Side · 1 Logo · Crew' },
  { key: '1s-2l-crew', label: '1 Side · 2 Logos · Crew' },
  { key: '2s-1l-crew', label: '2 Sides · 1 Logo · Crew' },
  { key: '2s-2l-crew', label: '2 Sides · 2 Logos · Crew' },
  { key: '1s-1l-half', label: '1 Side · 1 Logo · Half' },
  { key: '1s-2l-half', label: '1 Side · 2 Logos · Half' },
  { key: '2s-1l-half', label: '2 Sides · 1 Logo · Half' },
  { key: '2s-2l-half', label: '2 Sides · 2 Logos · Half' },
]

function snapTier(quantity: number): number {
  for (const t of QTY_TIERS) {
    if (quantity <= t) return t
  }
  return QTY_TIERS[QTY_TIERS.length - 1]
}

function formatDuration(totalSeconds: number): { hours: number; minutes: number; pretty: string } {
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.round((safe % 3600) / 60)
  const pretty = hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`
  return { hours, minutes, pretty }
}

export default function OemCalculatorPage() {
  // ── Inputs
  const [quantity, setQuantity] = useState(50)
  const [length, setLength] = useState<Length>('crew')
  const [sides, setSides] = useState<Sides>(1)
  const [logosPerSide, setLogosPerSide] = useState<LogosPerSide>(1)
  const [singlePackaging, setSinglePackaging] = useState(false)
  const [deadline, setDeadline] = useState('')

  // ── Editable configs (persisted)
  const [prices, setPrices] = useState<PriceGrid>(DEFAULT_PRICES)
  const [times, setTimes] = useState<TimeConfig>(DEFAULT_TIMES)
  const [hydrated, setHydrated] = useState(false)

  // ── UI
  const [showPriceEditor, setShowPriceEditor] = useState(false)
  const [showTimeEditor, setShowTimeEditor] = useState(false)

  useEffect(() => {
    try {
      const sp = localStorage.getItem(PRICE_KEY)
      if (sp) {
        const parsed = JSON.parse(sp) as PriceGrid
        setPrices({ ...DEFAULT_PRICES, ...parsed })
      }
      const st = localStorage.getItem(TIME_KEY)
      if (st) setTimes({ ...DEFAULT_TIMES, ...JSON.parse(st) })
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(PRICE_KEY, JSON.stringify(prices)) } catch {}
  }, [prices, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(TIME_KEY, JSON.stringify(times)) } catch {}
  }, [times, hydrated])

  // ── Derived
  const variantKey = `${sides}s-${logosPerSide}l-${length}`
  const variantLabel = VARIANT_LABELS.find((v) => v.key === variantKey)?.label ?? variantKey
  const tier = useMemo(() => snapTier(quantity), [quantity])
  const pricePerPair = prices[variantKey]?.[tier] ?? 0
  const totalRevenue = pricePerPair * quantity

  // 1 side → printed on one face of each sock (L+R sock). 2 sides → both faces of each sock.
  // logosPerSide controls how many logos on each printed face.
  // Total prints per pair = sides × logosPerSide × 2 socks.
  const printsPerPair = sides * logosPerSide * 2
  const printSecPerPair = times.secPerPrint * printsPerPair
  const clipSecPerPair = times.secClipPerPair
  const packSecPerPair = singlePackaging ? times.secPackPerPair : 0
  const secPerPair = printSecPerPair + clipSecPerPair + packSecPerPair
  const totalSec = secPerPair * quantity
  const dur = formatDuration(totalSec)

  // Working days estimate (8hr / day) — useful to compare against deadline.
  const workingDays = totalSec / (8 * 3600)

  const usingFallback = pricePerPair === 0

  function resetAll() {
    if (typeof window !== 'undefined' && window.confirm('Reset all prices and times to defaults? Your saved edits will be lost.')) {
      setPrices(DEFAULT_PRICES)
      setTimes(DEFAULT_TIMES)
    }
  }

  function updatePrice(key: VariantKey, qty: number, value: number) {
    setPrices((prev) => ({
      ...prev,
      [key]: { ...prev[key], [qty]: value },
    }))
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#0A0A0A] text-[#FFD700] flex items-center justify-center">
            <Calculator size={20} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">OEM Sock Calculator</h2>
            <p className="text-sm text-gray-500">Quote selling price and production time from quantity, sides, logos and length.</p>
          </div>
        </div>
        <button
          onClick={resetAll}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
          title="Reset prices and times to defaults"
        >
          <RotateCcw size={14} />
          Reset defaults
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Inputs ── */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6 space-y-5">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Order Details</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Quantity (pairs)">
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent"
              />
              <Hint>Snaps up to tier of <strong>{tier}</strong> pairs for pricing.</Hint>
            </Field>

            <Field label="Customer deadline (optional)">
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent"
              />
              <Hint>Used to flag if production time exceeds available days.</Hint>
            </Field>

            <Field label="Sock length">
              <Segmented
                options={[
                  { value: 'crew', label: 'Crew' },
                  { value: 'half', label: 'Half' },
                ]}
                value={length}
                onChange={(v) => setLength(v as Length)}
              />
            </Field>

            <Field label="Print sides">
              <Segmented
                options={[
                  { value: '1', label: '1 Side' },
                  { value: '2', label: '2 Sides' },
                ]}
                value={String(sides)}
                onChange={(v) => setSides(Number(v) as Sides)}
              />
              <Hint>1 side = print on one face of each sock. 2 sides = both faces.</Hint>
            </Field>

            <Field label="Logos per printed side">
              <Segmented
                options={[
                  { value: '1', label: '1 Logo' },
                  { value: '2', label: '2 Logos' },
                ]}
                value={String(logosPerSide)}
                onChange={(v) => setLogosPerSide(Number(v) as LogosPerSide)}
              />
              <Hint>{printsPerPair} total prints per pair ({sides} × {logosPerSide} × 2 socks).</Hint>
            </Field>

            <Field label="Single packaging">
              <label className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={singlePackaging}
                  onChange={(e) => setSinglePackaging(e.target.checked)}
                  className="w-4 h-4 accent-[#FFD700]"
                />
                <span className="text-sm text-gray-700">Slot each pair into an individual bag</span>
              </label>
              <Hint>Adds {times.secPackPerPair} sec per pair.</Hint>
            </Field>
          </div>
        </div>

        {/* ── Result ── */}
        <div className="bg-[#0A0A0A] text-white rounded-xl p-6 space-y-5">
          <h3 className="text-xs font-semibold text-[#FFD700] uppercase tracking-widest">Quote</h3>
          <div className="space-y-1">
            <p className="text-[11px] text-white/40 uppercase tracking-wider">Variant</p>
            <p className="text-sm font-medium">{variantLabel}</p>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-white/40 uppercase tracking-wider">Selling price (per pair)</p>
            <p className={cn('text-3xl font-bold', usingFallback ? 'text-red-400' : 'text-[#FFD700]')}>
              {usingFallback ? 'Not set' : formatCurrency(pricePerPair)}
            </p>
            {usingFallback && (
              <p className="text-[11px] text-red-300">Open the pricing grid below to set rates for this variant.</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-white/40 uppercase tracking-wider">Total revenue ({quantity} pairs)</p>
            <p className="text-xl font-semibold">{formatCurrency(totalRevenue)}</p>
          </div>

          <div className="h-px bg-white/10" />

          <div className="space-y-1">
            <p className="text-[11px] text-white/40 uppercase tracking-wider">Production time</p>
            <p className="text-2xl font-bold">{dur.pretty}</p>
            <p className="text-[11px] text-white/50">{secPerPair.toFixed(0)} sec/pair · ≈ {workingDays.toFixed(1)} working days (8 hr/day)</p>
          </div>

          {deadline && (() => {
            const due = new Date(deadline)
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const daysUntil = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
            const tight = daysUntil < workingDays
            return (
              <div className={cn('text-xs rounded-lg px-3 py-2 border', tight ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300')}>
                {tight
                  ? `Tight: ${daysUntil} day(s) until deadline, need ≈ ${workingDays.toFixed(1)} working days.`
                  : `OK: ${daysUntil} day(s) until deadline, need ≈ ${workingDays.toFixed(1)} working days.`}
              </div>
            )
          })()}

          <div className="text-[11px] text-white/40 space-y-0.5 pt-2">
            <p>Print: {(printSecPerPair * quantity / 60).toFixed(0)} min · Clip: {(clipSecPerPair * quantity / 60).toFixed(0)} min{singlePackaging ? ` · Pack: ${(packSecPerPair * quantity / 60).toFixed(0)} min` : ''}</p>
          </div>
        </div>
      </div>

      {/* ── Pricing editor ── */}
      <div className="bg-white rounded-xl border border-gray-100">
        <button
          onClick={() => setShowPriceEditor((s) => !s)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-900">Pricing grid (RM per pair)</span>
            <span className="text-xs text-gray-500">— edit and the calculator updates instantly</span>
          </div>
          {showPriceEditor ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
        </button>
        {showPriceEditor && (
          <div className="px-6 pb-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wide border-b border-gray-100">
                  <th className="py-2 pr-4 font-medium">Variant</th>
                  {QTY_TIERS.map((q) => (
                    <th key={q} className="py-2 px-2 font-medium text-right">{q}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VARIANT_LABELS.map(({ key, label }) => (
                  <tr key={key} className={cn('border-b border-gray-50', key === variantKey && 'bg-[#FFD700]/5')}>
                    <td className="py-2 pr-4 font-medium text-gray-700">{label}</td>
                    {QTY_TIERS.map((q) => (
                      <td key={q} className="py-1 px-1">
                        <input
                          type="number"
                          min={0}
                          step="0.50"
                          value={prices[key]?.[q] ?? 0}
                          onChange={(e) => updatePrice(key, q, Math.max(0, Number(e.target.value) || 0))}
                          className={cn(
                            'w-20 rounded border border-gray-200 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent',
                            key === variantKey && q === tier && 'border-[#FFD700] bg-white'
                          )}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-500 mt-3">
              Edits save to this browser. Quantities between tiers snap <strong>up</strong> to the next tier (e.g. 75 → uses the 100 column).
            </p>
          </div>
        )}
      </div>

      {/* ── Time editor ── */}
      <div className="bg-white rounded-xl border border-gray-100">
        <button
          onClick={() => setShowTimeEditor((s) => !s)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-900">Time per step (seconds)</span>
            <span className="text-xs text-gray-500">— tune these once you confirm real-world timing</span>
          </div>
          {showTimeEditor ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
        </button>
        {showTimeEditor && (
          <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Per single print">
              <input
                type="number"
                min={0}
                value={times.secPerPrint}
                onChange={(e) => setTimes((t) => ({ ...t, secPerPrint: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent"
              />
              <Hint>Default 45 sec per logo print.</Hint>
            </Field>
            <Field label="Clip & align per pair">
              <input
                type="number"
                min={0}
                value={times.secClipPerPair}
                onChange={(e) => setTimes((t) => ({ ...t, secClipPerPair: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent"
              />
              <Hint>Default 20 sec per pair.</Hint>
            </Field>
            <Field label="Single bag pack per pair">
              <input
                type="number"
                min={0}
                value={times.secPackPerPair}
                onChange={(e) => setTimes((t) => ({ ...t, secPackPerPair: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent"
              />
              <Hint>Default 15 sec per pair. Only applied when single packaging is on.</Hint>
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Small UI helpers ──

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-gray-500">{children}</p>
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 w-full">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 text-sm font-medium px-3 py-1.5 rounded-md transition-all',
              active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
