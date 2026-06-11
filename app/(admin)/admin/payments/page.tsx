'use client'

/**
 * Payments — collections command center.
 *
 * One screen for the team to see who has paid, who has submitted a receipt
 * that needs checking, and who is late. The review modal puts the uploaded
 * bank receipt NEXT TO the expected amount (xocks_revenue — the figure the
 * store must remit) so nobody has to open the invoice PDF and memorise
 * numbers while cross-checking.
 *
 * Due rule (matches the store-side bank card): payment for a month is due by
 * the 7th of the following month. After that the row shows days late.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Wallet, CheckCircle2, XCircle, Loader2, Receipt, AlertTriangle, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMonthYear, cn } from '@/lib/utils'
import type { CommissionPeriod, PaymentReceipt } from '@/types'

interface Row extends CommissionPeriod {
  store?: { store_name: string; store_code: string } & CommissionPeriod['store']
  receipt?: PaymentReceipt | null
}

type Tab = 'unpaid' | 'review' | 'overdue' | 'paid' | 'all'

function getMYNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
}

// Payment for period (M, Y) is due by the 7th of the following month.
// period_month is 1-based, JS Date months are 0-based — passing it straight
// through lands on the NEXT month, which is exactly what we want.
function dueDate(p: CommissionPeriod): Date {
  return new Date(p.period_year, p.period_month, 7, 23, 59, 59)
}

function daysOverdue(p: CommissionPeriod, now: Date): number {
  const diff = now.getTime() - dueDate(p).getTime()
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0
}

export default function AdminPaymentsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('unpaid')
  const [storeFilter, setStoreFilter] = useState('')
  const [reviewing, setReviewing] = useState<Row | null>(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [submitting, setSubmitting] = useState<'confirm' | 'reject' | null>(null)

  const now = getMYNow()

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('commission_periods')
      .select('*, store:stores(store_name, store_code), receipt:payment_receipts(*)')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })

    if (error) {
      toast.error(`Failed to load: ${error.message}`)
      setLoading(false)
      return
    }
    const normalized = ((data as Row[]) ?? []).map((p) => ({
      ...p,
      receipt: Array.isArray(p.receipt) ? ((p.receipt[0] as PaymentReceipt) ?? null) : (p.receipt ?? null),
    }))
    setRows(normalized)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const stores = useMemo(() => {
    const map = new Map<string, string>()
    rows.forEach((r) => { if (r.store) map.set(r.store.store_code, r.store.store_name) })
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  // Row state helpers
  const isPaid = (r: Row) => r.status === 'paid'
  const needsReview = (r: Row) => !isPaid(r) && r.receipt?.status === 'submitted'
  const isOverdue = (r: Row) => !isPaid(r) && !needsReview(r) && daysOverdue(r, now) > 0 && Number(r.xocks_revenue) > 0

  const filtered = rows.filter((r) => {
    if (storeFilter && r.store?.store_code !== storeFilter) return false
    switch (tab) {
      case 'unpaid': return !isPaid(r)
      case 'review': return needsReview(r)
      case 'overdue': return isOverdue(r)
      case 'paid': return isPaid(r)
      case 'all': return true
    }
  })

  // Summary numbers
  const outstanding = rows.filter((r) => !isPaid(r)).reduce((s, r) => s + Number(r.xocks_revenue), 0)
  const reviewCount = rows.filter(needsReview).length
  const overdueRows = rows.filter(isOverdue)
  const collectedThisMonth = rows
    .filter((r) => isPaid(r) && r.paid_at &&
      new Date(r.paid_at).getMonth() === now.getMonth() &&
      new Date(r.paid_at).getFullYear() === now.getFullYear())
    .reduce((s, r) => s + Number(r.xocks_revenue), 0)

  function rowStatus(r: Row): { label: string; classes: string } {
    if (isPaid(r)) return { label: 'Paid', classes: 'bg-green-100 text-green-700' }
    if (needsReview(r)) return { label: 'Receipt — review now', classes: 'bg-blue-100 text-blue-700' }
    if (r.receipt?.status === 'rejected') return { label: 'Rejected — awaiting re-upload', classes: 'bg-red-100 text-red-600' }
    const late = daysOverdue(r, now)
    if (late > 0 && Number(r.xocks_revenue) > 0) {
      return { label: `LATE ${late}d`, classes: 'bg-red-600 text-white' }
    }
    return { label: 'Awaiting payment', classes: 'bg-amber-100 text-amber-700' }
  }

  async function review(action: 'confirm' | 'reject') {
    if (!reviewing?.receipt) return
    if (action === 'reject' && !adminNotes.trim()) {
      toast.error('Tell the store why — the note is sent to them')
      return
    }
    setSubmitting(action)
    try {
      const res = await fetch(`/api/payments/receipts/${reviewing.receipt.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, admin_notes: adminNotes.trim() || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? 'Failed')
        return
      }
      toast.success(action === 'confirm' ? 'Payment confirmed — store notified' : 'Receipt rejected — store notified')
      setReviewing(null)
      setAdminNotes('')
      load()
    } finally {
      setSubmitting(null)
    }
  }

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'review', label: 'To Review', count: reviewCount },
    { key: 'overdue', label: 'Overdue', count: overdueRows.length },
    { key: 'paid', label: 'Paid' },
    { key: 'all', label: 'All' },
  ]

  const receiptIsImage = (r: PaymentReceipt | null | undefined) =>
    !!r?.mime_type && r.mime_type.startsWith('image/')

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Outstanding', value: formatCurrency(outstanding), icon: Wallet, color: 'text-amber-600', sub: 'unpaid invoices' },
          { label: 'Receipts to Review', value: String(reviewCount), icon: Receipt, color: 'text-blue-600', sub: 'waiting for your check' },
          { label: 'Overdue', value: String(overdueRows.length), icon: AlertTriangle, color: 'text-red-600', sub: formatCurrency(overdueRows.reduce((s, r) => s + Number(r.xocks_revenue), 0)) },
          { label: 'Collected This Month', value: formatCurrency(collectedThisMonth), icon: CheckCircle2, color: 'text-green-600', sub: 'confirmed payments' },
        ].map(({ label, value, icon: Icon, color, sub }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon size={15} className={color} />
              <p className="text-xs text-gray-500">{label}</p>
            </div>
            <p className="text-xl font-bold text-[#0A0A0A]">{value}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs + store filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg font-medium transition-colors',
                tab === t.key ? 'bg-[#0A0A0A] text-white' : 'text-gray-500 hover:bg-gray-100',
              )}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={cn(
                  'ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
                  tab === t.key ? 'bg-[#FFD700] text-[#0A0A0A]' : 'bg-red-500 text-white',
                )}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          >
            <option value="">All Stores</option>
            {stores.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {['Store', 'Period', 'To Collect', 'Due', 'Status', 'Receipt', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3].map((i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">
                  Nothing here — all clear 🎉
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const st = rowStatus(r)
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{r.store?.store_name ?? '—'}</p>
                      <p className="text-xs text-gray-400 font-mono">{r.store?.store_code}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatMonthYear(r.period_month, r.period_year)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-[#0A0A0A]">{formatCurrency(r.xocks_revenue)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {dueDate(r).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', st.classes)}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.receipt ? (
                        <a
                          href={`/api/payments/receipts/${r.receipt.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          <Receipt size={12} />
                          View
                        </a>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`/api/commissions/${r.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"
                        >
                          <FileText size={12} />
                          Invoice
                        </a>
                        {needsReview(r) && (
                          <button
                            onClick={() => { setReviewing(r); setAdminNotes('') }}
                            className="text-xs px-3 py-1.5 bg-[#0A0A0A] text-[#FFD700] rounded-lg font-semibold hover:bg-gray-800 transition-colors"
                          >
                            Review
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

      {/* Review modal — receipt next to the expected amount */}
      {reviewing && reviewing.receipt && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">
                Verify Payment — {reviewing.store?.store_name}
              </h3>
              <button onClick={() => setReviewing(null)} className="text-gray-400 hover:text-gray-700">
                <XCircle size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid md:grid-cols-2 gap-5">
                {/* Left: the receipt */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Uploaded Receipt</p>
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                    {receiptIsImage(reviewing.receipt) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/payments/receipts/${reviewing.receipt.id}/file`}
                        alt="Payment receipt"
                        className="w-full max-h-[420px] object-contain"
                      />
                    ) : (
                      <iframe
                        src={`/api/payments/receipts/${reviewing.receipt.id}/file`}
                        className="w-full h-[420px]"
                        title="Payment receipt"
                        sandbox="allow-same-origin"
                      />
                    )}
                  </div>
                  <div className="text-xs text-gray-500 space-y-1">
                    {reviewing.receipt.bank_reference && (
                      <p>Bank ref: <span className="font-mono font-semibold text-gray-700">{reviewing.receipt.bank_reference}</span></p>
                    )}
                    {reviewing.receipt.transfer_date && (
                      <p>Transfer date: {reviewing.receipt.transfer_date}</p>
                    )}
                    <p>Uploaded: {new Date(reviewing.receipt.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</p>
                    {reviewing.receipt.store_notes && <p>Store notes: {reviewing.receipt.store_notes}</p>}
                  </div>
                </div>

                {/* Right: what the number on the receipt MUST say */}
                <div className="space-y-4">
                  <div className="bg-[#0A0A0A] rounded-xl p-5 text-center">
                    <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Amount on receipt must be</p>
                    <p className="text-4xl font-extrabold text-[#FFD700] tracking-tight">
                      {formatCurrency(reviewing.xocks_revenue)}
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      {reviewing.store?.store_code} · {formatMonthYear(reviewing.period_month, reviewing.period_year)}
                    </p>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1.5">
                    <div className="flex justify-between"><span>Month revenue</span><span className="font-semibold">{formatCurrency(reviewing.total_revenue)}</span></div>
                    <div className="flex justify-between"><span>Store commission ({reviewing.total_revenue > 0 ? Math.round((reviewing.commission_amount / reviewing.total_revenue) * 100) : 0}%)</span><span className="font-semibold">− {formatCurrency(reviewing.commission_amount)}</span></div>
                    <div className="flex justify-between border-t border-gray-200 pt-1.5 text-gray-900 font-bold"><span>Balance to Xocks</span><span>{formatCurrency(reviewing.xocks_revenue)}</span></div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">
                      Notes (required when rejecting — sent to the store)
                    </label>
                    <textarea
                      rows={2}
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      placeholder="e.g. Amount on receipt shows RM 545.15, expected RM 1,234.56"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => review('reject')}
                      disabled={submitting !== null}
                      className="flex-1 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {submitting === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                      Reject
                    </button>
                    <button
                      onClick={() => review('confirm')}
                      disabled={submitting !== null}
                      className="flex-1 py-2.5 rounded-xl bg-[#0A0A0A] text-[#FFD700] text-sm font-bold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {submitting === 'confirm' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      Confirm Payment
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
