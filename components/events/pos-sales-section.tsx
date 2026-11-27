'use client'

// Event page → event summary + POS sales (admin only). Shows event profit and
// when bonuses unlocked — things part-timers never see on the POS.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Trophy, ChevronDown, ChevronRight, Ban, RefreshCcw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface SaleItem { name: string; sku: string; qty: number; stock_qty: number; unit_price: number; is_pair: boolean }
interface Sale {
  id: string; sale_no: number; staff_id: string; staff_name: string; event_day: string; payment_method: 'cash' | 'card' | 'qr'
  subtotal: number; discount_label: string | null; discount_amount: number; total: number; cash_received: number | null; change: number | null
  bonus_eligible_amount: number; voided_at: string | null; void_reason: string | null; created_at: string; pairs: number; items: SaleItem[]
}
interface PersonDay {
  staff_id: string; name: string; day: string; day_label: string | null; sales: number; pairs: number; total: number
  discounts: number; eligible: number; tier: number; bonus: number; tiers: number[] | null
}
interface Data {
  summary: {
    has_target: boolean; total_sales: number; event_costs: number | null; event_profit: number | null; profit_unlock_amount: number
    bonuses_unlocked_at: string | null; sales_count: number; pairs: number; discounts: number; bonus_total: number
    payments: { cash: number; card: number; qr: number }; top_seller: { name: string; total: number } | null
  }
  by_person_day: PersonDay[]
  sales: Sale[]
}

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const timeMY = (iso: string) => new Date(iso).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const PAY = { cash: 'Cash', card: 'Card', qr: 'QR' }

export function PosSalesSection({ eventId, eventName, isActive, refreshKey }: { eventId: string; eventName: string; isActive: boolean; refreshKey?: number }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [person, setPerson] = useState('all')
  const [day, setDay] = useState('all')
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/events/${eventId}/pos-sales`)
    const body = await res.json().catch(() => ({}))
    if (res.ok) setData(body)
    else toast.error(body.error ?? 'Could not load POS sales')
    setLoading(false)
  }, [eventId])
  useEffect(() => { load() }, [load, refreshKey])

  const filtered = useMemo(() => (data?.sales ?? []).filter((s) => (person === 'all' || s.staff_id === person) && (day === 'all' || s.event_day === day)), [data, person, day])
  const people = useMemo(() => [...new Map((data?.sales ?? []).map((s) => [s.staff_id, s.staff_name])).entries()], [data])
  const days = useMemo(() => [...new Set((data?.sales ?? []).map((s) => s.event_day))].sort(), [data])

  async function voidSale(s: Sale) {
    const reason = prompt(`Void sale #${s.sale_no} (${rm(s.total)} by ${s.staff_name})? Stock goes back to the event. Reason:`)
    if (reason === null) return
    if (!reason.trim()) { toast.error('Give a reason'); return }
    const res = await fetch(`/api/events/${eventId}/pos-sales/${s.id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error ?? 'Void failed'); return }
    toast.success(`Sale #${s.sale_no} voided`); load()
  }

  function exportCsv() {
    const rows = [['Sale #', 'Time (MYT)', 'Day', 'Part-timer', 'Payment', 'Item', 'SKU', 'Qty', 'Unit price', 'Sale subtotal', 'Discount', 'Discount RM', 'Sale total', 'Bonus-eligible RM', 'Cash received', 'Change', 'Voided', 'Void reason']]
    for (const s of filtered) {
      for (const i of s.items) {
        rows.push([String(s.sale_no), timeMY(s.created_at), s.event_day, s.staff_name, PAY[s.payment_method], i.name, i.sku, String(i.qty), i.unit_price.toFixed(2),
          s.subtotal.toFixed(2), s.discount_label ?? '', s.discount_amount.toFixed(2), s.total.toFixed(2), s.bonus_eligible_amount.toFixed(2),
          s.cash_received?.toFixed(2) ?? '', s.change?.toFixed(2) ?? '', s.voided_at ? 'yes' : '', s.void_reason ?? ''])
      }
    }
    const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `pos-sales-${eventName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  if (loading && !data) return <div className="bg-white rounded-xl border border-gray-100 p-5 text-sm text-gray-400">Loading sales…</div>
  if (!data) return null
  const s = data.summary
  const tierChip = (t: number) => t === 0 ? <span className="text-gray-400">—</span> : (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold', t === 1 ? 'bg-blue-100 text-blue-800' : t === 2 ? 'bg-[#FFD84D] text-gray-900' : 'bg-[#1F4BD8] text-white')}>T{t}</span>
  )

  return (
    <>
      {/* Event summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Event summary</h3>
          <button onClick={load} className="text-gray-400 hover:text-gray-700" title="Refresh"><RefreshCcw size={14} className={cn(loading && 'animate-spin')} /></button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total POS sales" value={rm(s.total_sales)} sub={`${s.sales_count} sales · ${s.pairs} pairs`} />
          <Stat label="Event costs" value={s.event_costs == null ? '—' : rm(s.event_costs)} sub={s.has_target ? 'from Targets' : 'save Targets first'} />
          <Stat label="Event profit" value={s.event_profit == null ? '—' : rm(s.event_profit)} sub="sales − costs (sock cost not included)" tone={s.event_profit != null && s.event_profit >= 0 ? 'good' : undefined} />
          <Stat label="Bonuses unlocked" value={!s.has_target ? 'Off' : s.bonuses_unlocked_at ? timeMY(s.bonuses_unlocked_at) : 'Not yet'}
            sub={!s.has_target ? 'no Targets saved' : s.bonuses_unlocked_at ? `${rm(s.bonus_total)} bonuses so far` : `at profit ≥ ${rm(s.profit_unlock_amount)}`} />
        </div>
      </div>

      {/* Sales */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900">POS sales</h3>
          <button onClick={exportCsv} disabled={!filtered.length} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5 disabled:opacity-40">
            <Download size={13} /> CSV
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Cash (count at closing)" value={rm(s.payments.cash)} tone="good" />
          <Stat label="Card" value={rm(s.payments.card)} />
          <Stat label="QR" value={rm(s.payments.qr)} />
          <Stat label="Discounts given" value={rm(s.discounts)} />
        </div>
        {s.top_seller && (
          <div className="flex items-center gap-2 text-sm bg-yellow-50 rounded-lg px-4 py-2.5">
            <Trophy size={16} className="text-[#B8860B]" /> Top seller of the event: <b>{s.top_seller.name}</b> · {rm(s.top_seller.total)}
          </div>
        )}

        {data.by_person_day.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left py-2 px-2 font-medium">Day</th>
                <th className="text-left py-2 px-2 font-medium">Part-timer</th>
                <th className="text-right py-2 px-2 font-medium">Sales</th>
                <th className="text-right py-2 px-2 font-medium">Pairs</th>
                <th className="text-right py-2 px-2 font-medium">Total</th>
                <th className="text-right py-2 px-2 font-medium">Discounts</th>
                <th className="text-right py-2 px-2 font-medium">Bonus-eligible</th>
                <th className="text-center py-2 px-2 font-medium">Tier</th>
                <th className="text-right py-2 px-2 font-medium">Bonus</th>
              </tr></thead>
              <tbody>
                {data.by_person_day.map((g) => (
                  <tr key={`${g.staff_id}${g.day}`} className="border-b border-gray-50">
                    <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{dayLabel(g.day)}</td>
                    <td className="py-2 px-2 font-medium text-gray-900">{g.name}</td>
                    <td className="py-2 px-2 text-right">{g.sales}</td>
                    <td className="py-2 px-2 text-right">{g.pairs}</td>
                    <td className="py-2 px-2 text-right">{rm(g.total)}</td>
                    <td className="py-2 px-2 text-right text-gray-500">{rm(g.discounts)}</td>
                    <td className="py-2 px-2 text-right" title={g.tiers ? `Tiers ${g.tiers.map((t) => `RM${t}`).join(' / ')}` : 'No target for this day'}>{rm(g.eligible)}</td>
                    <td className="py-2 px-2 text-center">{tierChip(g.tier)}</td>
                    <td className="py-2 px-2 text-right font-semibold">{g.bonus ? `RM${g.bonus}` : '—'}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 px-2" colSpan={2}>Event total</td>
                  <td className="py-2 px-2 text-right">{s.sales_count}</td>
                  <td className="py-2 px-2 text-right">{s.pairs}</td>
                  <td className="py-2 px-2 text-right">{rm(s.total_sales)}</td>
                  <td className="py-2 px-2 text-right">{rm(s.discounts)}</td>
                  <td className="py-2 px-2 text-right">{rm(data.by_person_day.reduce((a, g) => a + g.eligible, 0))}</td>
                  <td />
                  <td className="py-2 px-2 text-right">RM{s.bonus_total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <select value={person} onChange={(e) => setPerson(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
            <option value="all">Everyone</option>
            {people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
            <option value="all">All days</option>
            {days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
          </select>
          <span className="text-xs text-gray-400">{filtered.length} sale{filtered.length === 1 ? '' : 's'}</span>
        </div>

        {filtered.length === 0 ? <p className="text-sm text-gray-400">No POS sales yet.</p> : (
          <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {filtered.map((sale) => (
              <div key={sale.id} className={cn(sale.voided_at && 'bg-gray-50')}>
                <button onClick={() => setOpen(open === sale.id ? null : sale.id)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left">
                  <div className="flex items-center gap-2 min-w-0">
                    {open === sale.id ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className={cn('text-sm font-medium text-gray-900', sale.voided_at && 'line-through text-gray-400')}>#{sale.sale_no} · {sale.staff_name} · {PAY[sale.payment_method]}</p>
                      <p className="text-xs text-gray-400">{timeMY(sale.created_at)} · {sale.pairs} pairs{sale.discount_label ? ` · ${sale.discount_label} −${rm(sale.discount_amount)}` : ''}{sale.voided_at ? ` · VOIDED: ${sale.void_reason ?? ''}` : ''}</p>
                    </div>
                  </div>
                  <span className={cn('text-sm font-semibold shrink-0', sale.voided_at && 'line-through text-gray-400')}>{rm(sale.total)}</span>
                </button>
                {open === sale.id && (
                  <div className="px-9 pb-3 space-y-1">
                    {sale.items.map((i, k) => (
                      <div key={k} className="flex justify-between text-xs text-gray-600">
                        <span>{i.qty} × {i.name} <span className="text-gray-400 font-mono">{i.sku}</span>{i.stock_qty !== i.qty ? ` (${i.stock_qty} from stock)` : ''}</span>
                        <span>{rm(i.qty * i.unit_price)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-100"><span>Subtotal</span><span>{rm(sale.subtotal)}</span></div>
                    {sale.discount_amount > 0 && <div className="flex justify-between text-xs text-gray-500"><span>{sale.discount_label}</span><span>−{rm(sale.discount_amount)}</span></div>}
                    {sale.payment_method === 'cash' && sale.cash_received != null && <div className="flex justify-between text-xs text-gray-500"><span>Cash received / change</span><span>{rm(sale.cash_received)} / {rm(sale.change ?? 0)}</span></div>}
                    <div className="flex justify-between text-xs text-gray-500"><span>Counts toward bonus</span><span>{rm(sale.bonus_eligible_amount)}</span></div>
                    {isActive && !sale.voided_at && (
                      <button onClick={() => voidSale(sale)} className="mt-2 flex items-center gap-1 text-xs text-red-600 hover:underline"><Ban size={12} /> Void sale</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' }) {
  return (
    <div className={cn('rounded-lg p-3', tone === 'good' ? 'bg-green-50' : 'bg-gray-50')}>
      <p className="text-[11px] text-gray-500 font-medium">{label}</p>
      <p className="text-base font-bold text-gray-900 mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
