'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download, CheckSquare, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMonthYear, cn } from '@/lib/utils'
import type { CommissionPeriod, CommissionStatus } from '@/types'
import { toast } from 'sonner'

interface CommissionRow extends CommissionPeriod {
  store_name: string
  city: string
  state: string
}

function StatusBadge({ status }: { status: CommissionStatus }) {
  const map: Record<CommissionStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    disputed: 'bg-red-100 text-red-700',
  }
  return (
    <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium capitalize', map[status])}>
      {status}
    </span>
  )
}

export default function CommissionsPage() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [rows, setRows] = useState<CommissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paymentRefs, setPaymentRefs] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [bulkPayRef, setBulkPayRef] = useState('')
  const [bulkPayOpen, setBulkPayOpen] = useState(false)
  const supabase = createClient()

  const fetchCommissions = useCallback(async () => {
    setLoading(true)
    setSelected(new Set())
    const { data } = await supabase
      .from('commission_periods')
      .select('*, store:stores(store_name, city, state)')
      .eq('period_month', month)
      .eq('period_year', year)
      .order('commission_amount', { ascending: false })

    setRows(
      (data || []).map((c: any) => ({
        ...c,
        store_name: c.store?.store_name || '—',
        city: c.store?.city || '—',
        state: c.store?.state || '—',
      }))
    )
    setLoading(false)
  }, [month, year])

  useEffect(() => { fetchCommissions() }, [fetchCommissions])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === rows.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map((r) => r.id)))
    }
  }

  async function approveRow(id: string) {
    const { error } = await supabase
      .from('commission_periods')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) toast.error('Failed to approve')
    else { toast.success('Approved'); fetchCommissions() }
  }

  async function markPaidRow(id: string) {
    const ref = paymentRefs[id]?.trim()
    if (!ref) { toast.error('Enter payment reference for this row'); return }
    const { error } = await supabase
      .from('commission_periods')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_reference: ref })
      .eq('id', id)
    if (error) toast.error('Failed to mark paid')
    else {
      toast.success('Marked as paid')
      setPaymentRefs((prev) => { const n = { ...prev }; delete n[id]; return n })
      fetchCommissions()
    }
  }

  async function bulkApprove() {
    const ids = Array.from(selected)
    if (ids.length === 0) { toast.error('No rows selected'); return }
    const { error } = await supabase
      .from('commission_periods')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .in('id', ids)
    if (error) toast.error('Failed')
    else { toast.success(`${ids.length} approved`); fetchCommissions() }
  }

  async function bulkMarkPaid() {
    if (!bulkPayRef.trim()) { toast.error('Enter payment reference'); return }
    const ids = Array.from(selected)
    if (ids.length === 0) { toast.error('No rows selected'); return }
    const { error } = await supabase
      .from('commission_periods')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_reference: bulkPayRef })
      .in('id', ids)
    if (error) toast.error('Failed')
    else {
      toast.success(`${ids.length} marked as paid`)
      setBulkPayOpen(false)
      setBulkPayRef('')
      fetchCommissions()
    }
  }

  async function generateStatements() {
    setGenerating(true)
    try {
      const res = await fetch('/api/commissions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year }),
      })
      if (res.ok) {
        toast.success('Statements generated')
        fetchCommissions()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to generate')
      }
    } catch {
      toast.error('An error occurred')
    }
    setGenerating(false)
  }

  const totalDue = rows.reduce((a, r) => a + (r.status !== 'paid' ? r.commission_amount : 0), 0)
  const paidCount = rows.filter((r) => r.status === 'paid').length
  const totalStores = rows.length

  return (
    <div className="space-y-5">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {new Date(2000, m - 1).toLocaleString('en', { month: 'long' })}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          >
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={generateStatements}
            disabled={generating}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {generating ? 'Generating...' : `Generate ${new Date(year, month - 1).toLocaleString('en', { month: 'short' })} Statements`}
          </button>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{selected.size} selected</span>
            <button
              onClick={bulkApprove}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
            >
              Approve All
            </button>
            <button
              onClick={() => setBulkPayOpen(true)}
              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition-colors"
            >
              Mark All Paid
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs text-gray-500">Total Commission Due</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalDue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatMonthYear(month, year)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs text-gray-500">Stores Paid</p>
          <p className="text-xl font-bold text-green-600 mt-1">{paidCount} / {totalStores}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs text-gray-500">Total Commission</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {formatCurrency(rows.reduce((a, r) => a + r.commission_amount, 0))}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={toggleSelectAll}
                    className="accent-[#FFD700]"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Store</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">City</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">State</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Pairs Sold</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Revenue</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Rate %</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Commission</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => (
                    <tr key={row.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50', selected.has(row.id) && 'bg-blue-50/30')}>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="accent-[#FFD700]"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{row.store_name}</td>
                      <td className="px-4 py-3 text-gray-600">{row.city}</td>
                      <td className="px-4 py-3 text-gray-600">{row.state}</td>
                      <td className="px-4 py-3 text-right">{row.total_units_sold}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(row.total_revenue)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {row.total_revenue > 0
                          ? ((row.commission_amount / row.total_revenue) * 100).toFixed(0)
                          : 0}%
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(row.commission_amount)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {row.pdf_url && (
                            <a
                              href={row.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            >
                              <Download size={12} />
                              PDF
                            </a>
                          )}
                          {row.status === 'pending' && (
                            <button
                              onClick={() => approveRow(row.id)}
                              className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                              Approve
                            </button>
                          )}
                          {row.status === 'approved' && (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                placeholder="Ref..."
                                value={paymentRefs[row.id] || ''}
                                onChange={(e) =>
                                  setPaymentRefs((prev) => ({ ...prev, [row.id]: e.target.value }))
                                }
                                className="w-24 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#FFD700]"
                              />
                              <button
                                onClick={() => markPaidRow(row.id)}
                                className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                              >
                                Paid
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No commission data for {formatMonthYear(month, year)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Mark Paid Modal */}
      {bulkPayOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Mark {selected.size} as Paid</h3>
              <button onClick={() => setBulkPayOpen(false)}>
                <X size={18} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 block mb-1">Payment Reference</label>
              <input
                type="text"
                value={bulkPayRef}
                onChange={(e) => setBulkPayRef(e.target.value)}
                placeholder="e.g. TT-20240601"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setBulkPayOpen(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={bulkMarkPaid}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
