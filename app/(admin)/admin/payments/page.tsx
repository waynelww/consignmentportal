'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Wallet, CheckCircle2, XCircle, Loader2, Receipt, AlertTriangle,
  FileText, Download, BadgeCheck, ArrowUpDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMonthYear, cn } from '@/lib/utils'
import type { CommissionPeriod, PaymentReceipt } from '@/types'

interface Row extends CommissionPeriod {
  store?: { store_name: string; store_code: string } & CommissionPeriod['store']
  receipt?: PaymentReceipt | null
}

type Tab    = 'unpaid' | 'review' | 'overdue' | 'paid' | 'all'
type SortBy = 'period-desc' | 'period-asc' | 'amount-desc' | 'amount-asc' | 'store'

function getMYNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
}
function dueDate(p: CommissionPeriod): Date {
  return new Date(p.period_year, p.period_month, 7, 23, 59, 59)
}
function daysOverdue(p: CommissionPeriod, now: Date): number {
  const diff = now.getTime() - dueDate(p).getTime()
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0
}

export default function AdminPaymentsPage() {
  const [rows, setRows]     = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState<Tab>('unpaid')
  const [storeFilter, setStoreFilter]   = useState('')
  const [periodFilter, setPeriodFilter] = useState('')   // YYYY-MM
  const [sortBy, setSortBy] = useState<SortBy>('period-desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Receipt review modal
  const [reviewing, setReviewing]   = useState<Row | null>(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [submitting, setSubmitting] = useState<'confirm' | 'reject' | null>(null)

  // Invoice PDF popup
  const [invoiceViewing, setInvoiceViewing] = useState<Row | null>(null)

  // Single mark-as-paid modal
  const [markingPaid, setMarkingPaid] = useState<Row | null>(null)
  const [payRef, setPayRef]           = useState('')
  const [markingPaidSubmitting, setMarkingPaidSubmitting] = useState(false)

  // Bulk mark-as-paid modal
  const [bulkPayModal, setBulkPayModal]   = useState(false)
  const [bulkPayRef, setBulkPayRef]       = useState('')
  const [bulkPaySubmitting, setBulkPaySubmitting] = useState(false)

  const now = getMYNow()

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('commission_periods')
      .select('*, store:stores(store_name, store_code), receipt:payment_receipts(*)')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
    if (error) { toast.error(`Failed to load: ${error.message}`); setLoading(false); return }
    const normalized = ((data as Row[]) ?? []).map((p) => ({
      ...p,
      receipt: Array.isArray(p.receipt) ? ((p.receipt[0] as PaymentReceipt) ?? null) : (p.receipt ?? null),
    }))
    setRows(normalized)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()) }, [tab, storeFilter, periodFilter, sortBy])

  const stores = useMemo(() => {
    const map = new Map<string, string>()
    rows.forEach((r) => { if (r.store) map.set(r.store.store_code, r.store.store_name) })
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const isPaid      = (r: Row) => r.status === 'paid'
  const needsReview = (r: Row) => !isPaid(r) && r.receipt?.status === 'submitted'
  const isOverdue   = (r: Row) => !isPaid(r) && !needsReview(r) && daysOverdue(r, now) > 0 && Number(r.xocks_revenue) > 0

  const filtered = useMemo(() => rows.filter((r) => {
    if (storeFilter && r.store?.store_code !== storeFilter) return false
    if (periodFilter) {
      const rp = `${r.period_year}-${String(r.period_month).padStart(2, '0')}`
      if (rp !== periodFilter) return false
    }
    switch (tab) {
      case 'unpaid':  return !isPaid(r)
      case 'review':  return needsReview(r)
      case 'overdue': return isOverdue(r)
      case 'paid':    return isPaid(r)
      case 'all':     return true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, tab, storeFilter, periodFilter])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'period-asc':  return (a.period_year * 100 + a.period_month) - (b.period_year * 100 + b.period_month)
        case 'amount-desc': return Number(b.xocks_revenue) - Number(a.xocks_revenue)
        case 'amount-asc':  return Number(a.xocks_revenue) - Number(b.xocks_revenue)
        case 'store':       return (a.store?.store_name ?? '').localeCompare(b.store?.store_name ?? '')
        default:            return (b.period_year * 100 + b.period_month) - (a.period_year * 100 + a.period_month)
      }
    })
  }, [filtered, sortBy])

  // Summary tiles
  const outstanding        = rows.filter((r) => !isPaid(r)).reduce((s, r) => s + Number(r.xocks_revenue), 0)
  const reviewCount        = rows.filter(needsReview).length
  const overdueRows        = rows.filter(isOverdue)
  const collectedThisMonth = rows
    .filter((r) => isPaid(r) && r.paid_at &&
      new Date(r.paid_at).getMonth() === now.getMonth() &&
      new Date(r.paid_at).getFullYear() === now.getFullYear())
    .reduce((s, r) => s + Number(r.xocks_revenue), 0)

  // Checkbox helpers
  const allVisibleIds = sorted.map((r) => r.id)
  const allSelected   = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id))
  const someSelected  = !allSelected && allVisibleIds.some((id) => selectedIds.has(id))
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allVisibleIds))
  }
  function toggleRow(id: string) {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function rowStatus(r: Row): { label: string; classes: string } {
    if (isPaid(r)) return { label: 'Paid', classes: 'bg-green-100 text-green-700' }
    if (needsReview(r)) return { label: 'Receipt — review now', classes: 'bg-blue-100 text-blue-700' }
    if (r.receipt?.status === 'rejected') return { label: 'Rejected — re-upload', classes: 'bg-red-100 text-red-600' }
    const late = daysOverdue(r, now)
    if (late > 0 && Number(r.xocks_revenue) > 0) return { label: `LATE ${late}d`, classes: 'bg-red-600 text-white' }
    return { label: 'Awaiting payment', classes: 'bg-amber-100 text-amber-700' }
  }

  async function review(action: 'confirm' | 'reject') {
    if (!reviewing?.receipt) return
    if (action === 'reject' && !adminNotes.trim()) { toast.error('Tell the store why — the note is sent to them'); return }
    setSubmitting(action)
    try {
      const res = await fetch(`/api/payments/receipts/${reviewing.receipt.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, admin_notes: adminNotes.trim() || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Failed'); return }
      toast.success(action === 'confirm' ? 'Payment confirmed — store notified' : 'Receipt rejected — store notified')
      setReviewing(null); setAdminNotes(''); load()
    } finally { setSubmitting(null) }
  }

  async function markPaid() {
    if (!markingPaid) return
    setMarkingPaidSubmitting(true)
    try {
      const res = await fetch(`/api/commissions/${markingPaid.id}/pay`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_reference: payRef.trim() || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Failed'); return }
      toast.success('Payment confirmed — store notified')
      setMarkingPaid(null); setPayRef(''); load()
    } finally { setMarkingPaidSubmitting(false) }
  }

  async function executeBulkPay() {
    const targets = sorted.filter((r) => selectedIds.has(r.id) && !isPaid(r))
    if (targets.length === 0) return
    setBulkPaySubmitting(true)
    let ok = 0, fail = 0
    for (const r of targets) {
      const res = await fetch(`/api/commissions/${r.id}/pay`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_reference: bulkPayRef.trim() || null }),
      })
      res.ok ? ok++ : fail++
    }
    setBulkPaySubmitting(false); setBulkPayModal(false); setBulkPayRef('')
    setSelectedIds(new Set())
    if (ok)   toast.success(`${ok} payment${ok > 1 ? 's' : ''} confirmed`)
    if (fail) toast.error(`${fail} failed — check individually`)
    load()
  }

  function downloadInvoices(ids: string[]) {
    if (ids.length === 0) return
    const targets = sorted.filter((r) => ids.includes(r.id))
    targets.forEach((r, i) => {
      setTimeout(() => {
        const a = document.createElement('a'); a.href = `/api/commissions/${r.id}/pdf`
        a.download = ''; document.body.appendChild(a); a.click(); document.body.removeChild(a)
      }, i * 700)
    })
    toast.success(`Downloading ${targets.length} invoice${targets.length > 1 ? 's' : ''}…`)
  }

  const receiptIsImage = (r: PaymentReceipt | null | undefined) =>
    !!r?.mime_type && r.mime_type.startsWith('image/')

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'unpaid',  label: 'Unpaid' },
    { key: 'review',  label: 'To Review', count: reviewCount },
    { key: 'overdue', label: 'Overdue', count: overdueRows.length },
    { key: 'paid',    label: 'Paid' },
    { key: 'all',     label: 'All' },
  ]

  const selectedCount = selectedIds.size
  const selectedRows  = sorted.filter((r) => selectedIds.has(r.id))
  const canBulkPay    = selectedRows.some((r) => !isPaid(r) && !needsReview(r))

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Outstanding',        value: formatCurrency(outstanding),    icon: Wallet,       color: 'text-amber-600', sub: 'unpaid invoices' },
          { label: 'Receipts to Review', value: String(reviewCount),            icon: Receipt,      color: 'text-blue-600',  sub: 'waiting for your check' },
          { label: 'Overdue',            value: String(overdueRows.length),     icon: AlertTriangle,color: 'text-red-600',   sub: formatCurrency(overdueRows.reduce((s, r) => s + Number(r.xocks_revenue), 0)) },
          { label: 'Collected This Month',value: formatCurrency(collectedThisMonth), icon: CheckCircle2, color: 'text-green-600', sub: 'confirmed payments' },
        ].map(({ label, value, icon: Icon, color, sub }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-1"><Icon size={15} className={color} /><p className="text-xs text-gray-500">{label}</p></div>
            <p className="text-xl font-bold text-[#0A0A0A]">{value}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs + filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
        {/* Tab row */}
        <div className="flex items-center gap-1 flex-wrap">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('px-3 py-1.5 text-sm rounded-lg font-medium transition-colors',
                tab === t.key ? 'bg-[#0A0A0A] text-white' : 'text-gray-500 hover:bg-gray-100')}>
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={cn('ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
                  tab === t.key ? 'bg-[#FFD700] text-[#0A0A0A]' : 'bg-red-500 text-white')}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* Filter + sort row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Month filter */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 whitespace-nowrap">Month</label>
            <input type="month" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}
              className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
            {periodFilter && (
              <button onClick={() => setPeriodFilter('')} className="text-xs text-gray-400 hover:text-gray-700">✕</button>
            )}
          </div>
          {/* Store filter */}
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
            <option value="">All Stores</option>
            {stores.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          {/* Sort */}
          <div className="flex items-center gap-1.5">
            <ArrowUpDown size={13} className="text-gray-400" />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
              <option value="period-desc">Period (Newest)</option>
              <option value="period-asc">Period (Oldest)</option>
              <option value="amount-desc">Amount (High → Low)</option>
              <option value="amount-asc">Amount (Low → High)</option>
              <option value="store">Store A → Z</option>
            </select>
          </div>
          {/* Download All */}
          {sorted.length > 0 && (
            <button onClick={() => downloadInvoices(sorted.map((r) => r.id))}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              <Download size={13} />
              Download All ({sorted.length})
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar — appears when rows are ticked */}
      {selectedCount > 0 && (
        <div className="bg-[#0A0A0A] text-white rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">{selectedCount} selected</span>
          <button onClick={() => downloadInvoices(Array.from(selectedIds))}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
            <Download size={13} /> Download Invoices
          </button>
          {canBulkPay && (
            <button onClick={() => { setBulkPayModal(true); setBulkPayRef('') }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#FFD700] text-[#0A0A0A] font-bold rounded-lg hover:bg-yellow-400 transition-colors">
              <BadgeCheck size={13} /> Mark as Paid
            </button>
          )}
          <button onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-white/60 hover:text-white transition-colors">
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 w-10">
                <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleAll}
                  className="rounded border-gray-300 text-[#0A0A0A] focus:ring-[#FFD700] cursor-pointer" />
              </th>
              {['Store', 'Period', 'To Collect', 'Due', 'Status', 'Receipt', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1,2,3].map((i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Nothing here — all clear</td></tr>
            ) : (
              sorted.map((r) => {
                const st = rowStatus(r)
                const checked = selectedIds.has(r.id)
                return (
                  <tr key={r.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', checked && 'bg-amber-50/50')}>
                    <td className="px-4 py-3 w-10">
                      <input type="checkbox" checked={checked} onChange={() => toggleRow(r.id)}
                        className="rounded border-gray-300 text-[#0A0A0A] focus:ring-[#FFD700] cursor-pointer" />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{r.store?.store_name ?? '—'}</p>
                      <p className="text-xs text-gray-400 font-mono">{r.store?.store_code}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatMonthYear(r.period_month, r.period_year)}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-[#0A0A0A]">{formatCurrency(r.xocks_revenue)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {dueDate(r).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', st.classes)}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      {r.receipt ? (
                        <a href={`/api/payments/receipts/${r.receipt.id}/file`} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                          <Receipt size={12} /> View
                        </a>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setInvoiceViewing(r)}
                          className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 transition-colors">
                          <FileText size={12} /> Invoice
                        </button>
                        {needsReview(r) && (
                          <button onClick={() => { setReviewing(r); setAdminNotes('') }}
                            className="text-xs px-3 py-1.5 bg-[#0A0A0A] text-[#FFD700] rounded-lg font-semibold hover:bg-gray-800 transition-colors">
                            Review
                          </button>
                        )}
                        {!isPaid(r) && !needsReview(r) && (
                          <button onClick={() => { setMarkingPaid(r); setPayRef('') }}
                            className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors inline-flex items-center gap-1">
                            <BadgeCheck size={12} /> Mark Paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Invoice PDF popup ─────────────────────────────────────────────────── */}
      {invoiceViewing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col" style={{ height: '90vh' }}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{invoiceViewing.store?.store_name}</h3>
                <p className="text-xs text-gray-400">{formatMonthYear(invoiceViewing.period_month, invoiceViewing.period_year)} · {invoiceViewing.store?.store_code}</p>
              </div>
              <div className="flex items-center gap-2">
                <a href={`/api/commissions/${invoiceViewing.id}/pdf`} download
                  className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 transition-colors">
                  <Download size={12} /> Download
                </a>
                <button onClick={() => setInvoiceViewing(null)} className="text-gray-400 hover:text-gray-700"><XCircle size={18} /></button>
              </div>
            </div>
            <iframe src={`/api/commissions/${invoiceViewing.id}/pdf?inline=1`} className="flex-1 w-full rounded-b-xl" title="Invoice PDF" />
          </div>
        </div>
      )}

      {/* ── Receipt review modal ──────────────────────────────────────────────── */}
      {reviewing && reviewing.receipt && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Verify Payment — {reviewing.store?.store_name}</h3>
              <button onClick={() => setReviewing(null)} className="text-gray-400 hover:text-gray-700"><XCircle size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid md:grid-cols-2 gap-5">
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Uploaded Receipt</p>
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                    {receiptIsImage(reviewing.receipt) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/payments/receipts/${reviewing.receipt.id}/file`} alt="Payment receipt" className="w-full max-h-[420px] object-contain" />
                    ) : (
                      <iframe src={`/api/payments/receipts/${reviewing.receipt.id}/file`} className="w-full h-[420px]" title="Payment receipt" sandbox="allow-same-origin" />
                    )}
                  </div>
                  <div className="text-xs text-gray-500 space-y-1">
                    {reviewing.receipt.bank_reference && <p>Bank ref: <span className="font-mono font-semibold text-gray-700">{reviewing.receipt.bank_reference}</span></p>}
                    {reviewing.receipt.transfer_date && <p>Transfer date: {reviewing.receipt.transfer_date}</p>}
                    <p>Uploaded: {new Date(reviewing.receipt.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</p>
                    {reviewing.receipt.store_notes && <p>Store notes: {reviewing.receipt.store_notes}</p>}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="bg-[#0A0A0A] rounded-xl p-5 text-center">
                    <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Amount on receipt must be</p>
                    <p className="text-4xl font-extrabold text-[#FFD700] tracking-tight">{formatCurrency(reviewing.xocks_revenue)}</p>
                    <p className="text-xs text-gray-400 mt-2">{reviewing.store?.store_code} · {formatMonthYear(reviewing.period_month, reviewing.period_year)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1.5">
                    <div className="flex justify-between"><span>Month revenue</span><span className="font-semibold">{formatCurrency(reviewing.total_revenue)}</span></div>
                    <div className="flex justify-between"><span>Store commission ({reviewing.total_revenue > 0 ? Math.round((reviewing.commission_amount / reviewing.total_revenue) * 100) : 0}%)</span><span className="font-semibold">− {formatCurrency(reviewing.commission_amount)}</span></div>
                    <div className="flex justify-between border-t border-gray-200 pt-1.5 text-gray-900 font-bold"><span>Balance to Xocks</span><span>{formatCurrency(reviewing.xocks_revenue)}</span></div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Notes (required when rejecting)</label>
                    <textarea rows={2} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)}
                      placeholder="e.g. Amount shows RM 545.15, expected RM 1,234.56"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => review('reject')} disabled={submitting !== null}
                      className="flex-1 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50 flex items-center justify-center gap-1.5">
                      {submitting === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
                    </button>
                    <button onClick={() => review('confirm')} disabled={submitting !== null}
                      className="flex-1 py-2.5 rounded-xl bg-[#0A0A0A] text-[#FFD700] text-sm font-bold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-1.5">
                      {submitting === 'confirm' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirm Payment
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Single mark-as-paid modal ─────────────────────────────────────────── */}
      {markingPaid && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Confirm Payment Received</h3>
              <button onClick={() => setMarkingPaid(null)} className="text-gray-400 hover:text-gray-700"><XCircle size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-800">{markingPaid.store?.store_name}</p>
                <p className="text-xs text-gray-400">{formatMonthYear(markingPaid.period_month, markingPaid.period_year)} · {markingPaid.store?.store_code}</p>
              </div>
              <div className="bg-[#0A0A0A] rounded-xl p-4 text-center">
                <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Amount to Receive</p>
                <p className="text-3xl font-extrabold text-[#FFD700]">{formatCurrency(markingPaid.xocks_revenue)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1.5">
                <div className="flex justify-between"><span>Month revenue</span><span className="font-semibold">{formatCurrency(markingPaid.total_revenue)}</span></div>
                <div className="flex justify-between"><span>Store commission</span><span className="font-semibold">− {formatCurrency(markingPaid.commission_amount)}</span></div>
                <div className="flex justify-between border-t border-gray-200 pt-1.5 font-bold text-gray-900"><span>Balance to Xocks</span><span>{formatCurrency(markingPaid.xocks_revenue)}</span></div>
              </div>
              <input type="text" value={payRef} onChange={(e) => setPayRef(e.target.value)}
                placeholder="Bank reference (optional)"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
              <button onClick={markPaid} disabled={markingPaidSubmitting}
                className="w-full py-2.5 rounded-xl bg-[#0A0A0A] text-[#FFD700] text-sm font-bold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {markingPaidSubmitting ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
                Confirm Payment Received
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk mark-as-paid modal ───────────────────────────────────────────── */}
      {bulkPayModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Bulk Confirm Payments</h3>
              <button onClick={() => setBulkPayModal(false)} className="text-gray-400 hover:text-gray-700"><XCircle size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Marking <span className="font-bold text-gray-900">{sorted.filter((r) => selectedIds.has(r.id) && !isPaid(r)).length} invoice{sorted.filter((r) => selectedIds.has(r.id) && !isPaid(r)).length > 1 ? 's' : ''}</span> as paid.
                All selected stores will be notified.
              </p>
              <div className="bg-gray-50 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {sorted.filter((r) => selectedIds.has(r.id) && !isPaid(r)).map((r) => (
                  <div key={r.id} className="px-3 py-2 flex justify-between text-xs">
                    <span className="text-gray-700 font-medium">{r.store?.store_name}</span>
                    <span className="text-gray-500">{formatMonthYear(r.period_month, r.period_year)} · <span className="font-semibold text-gray-900">{formatCurrency(r.xocks_revenue)}</span></span>
                  </div>
                ))}
              </div>
              <input type="text" value={bulkPayRef} onChange={(e) => setBulkPayRef(e.target.value)}
                placeholder="Shared bank reference (optional)"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
              <button onClick={executeBulkPay} disabled={bulkPaySubmitting}
                className="w-full py-2.5 rounded-xl bg-[#0A0A0A] text-[#FFD700] text-sm font-bold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {bulkPaySubmitting ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
                Confirm All Payments
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
