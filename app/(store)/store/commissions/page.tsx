'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, BookOpen } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMonthYear } from '@/lib/utils'
import type { CommissionPeriod, Sale, Store } from '@/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/components/store/StoreContext'

function getMYNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
}

export default function CommissionsPage() {
  const { storeId, store: contextStore } = useStore()
  const [periods, setPeriods] = useState<CommissionPeriod[]>([])
  const [currentMonthSales, setCurrentMonthSales] = useState(0)
  const [currentMonthRevenue, setCurrentMonthRevenue] = useState(0)
  const [currentMonthCommission, setCurrentMonthCommission] = useState(0)
  const [commissionRate, setCommissionRate] = useState(contextStore?.commission_rate ?? 0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    const supabase = createClient()

    // storeId + commission_rate from context — skip auth waterfall and stores query
    const now = getMYNow()
    const thisMonth = now.getMonth() + 1
    const thisYear = now.getFullYear()
    const pad = (n: number) => String(n).padStart(2, '0')
    const firstOfMonth = `${thisYear}-${pad(thisMonth)}-01`

    const [periodsRes, salesRes] = await Promise.all([
      supabase
        .from('commission_periods')
        .select('*')
        .eq('store_id', storeId)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false }),
      supabase
        .from('sales')
        .select('quantity, total_amount, commission_amount')
        .eq('store_id', storeId)
        .gte('sale_date', firstOfMonth),
    ])

    setCommissionRate(contextStore?.commission_rate ?? 0)
    setPeriods((periodsRes.data as CommissionPeriod[]) ?? [])

    const sales = (salesRes.data as Pick<Sale, 'quantity' | 'total_amount' | 'commission_amount'>[]) ?? []
    setCurrentMonthSales(sales.reduce((s, x) => s + x.quantity, 0))
    setCurrentMonthRevenue(sales.reduce((s, x) => s + x.total_amount, 0))
    setCurrentMonthCommission(sales.reduce((s, x) => s + x.commission_amount, 0))

    // Auto-generate the PREVIOUS month's invoice if it doesn't exist yet
    const prevMonth = thisMonth === 1 ? 12 : thisMonth - 1
    const prevYear = thisMonth === 1 ? thisYear - 1 : thisYear
    const alreadyExists = (periodsRes.data ?? []).some(
      (p: CommissionPeriod) => p.period_month === prevMonth && p.period_year === prevYear
    )
    if (!alreadyExists) {
      fetch('/api/commissions/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: prevMonth, year: prevYear }),
      }).then((res) => {
        if (res.ok) {
          // Reload to show the newly generated period
          supabase
            .from('commission_periods')
            .select('*')
            .eq('store_id', storeId!)
            .order('period_year', { ascending: false })
            .order('period_month', { ascending: false })
            .then(({ data }) => {
              if (data) setPeriods(data as CommissionPeriod[])
            })
        }
      })
    }

    setLoading(false)
  }, [storeId, contextStore]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const now = getMYNow()
  const currentMonthLabel = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' })

  const statusConfig: Record<string, { label: string; classes: string }> = {
    pending:  { label: 'Pending',  classes: 'bg-amber-100 text-amber-700' },
    approved: { label: 'Approved', classes: 'bg-blue-100 text-blue-700' },
    paid:     { label: 'Paid',     classes: 'bg-green-100 text-green-700' },
    disputed: { label: 'Disputed', classes: 'bg-red-100 text-red-600' },
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-bold text-[#0A0A0A]">Commissions & Invoices</h1>

      {/* Current month live card */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm p-5 animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-10 bg-gray-200 rounded w-2/3" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
      ) : (
        <div className="bg-[#0A0A0A] rounded-xl p-5">
          <p className="text-gray-400 text-xs mb-0.5">{currentMonthLabel} — Live</p>
          <p className="text-sm text-gray-400">You've earned this month</p>
          <p className="text-4xl font-bold text-[#FFD700] mt-1">{formatCurrency(currentMonthCommission)}</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-gray-400">Pairs Sold</p>
              <p className="text-xl font-bold text-white">{currentMonthSales}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Revenue</p>
              <p className="text-sm font-bold text-white">{formatCurrency(currentMonthRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Rate</p>
              <p className="text-xl font-bold text-[#FFD700]">{commissionRate}%</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-gray-400 text-center">
              Invoice auto-generated on the 1st of next month
            </p>
          </div>
        </div>
      )}

      {/* Past invoices */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Past Invoices</h2>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : periods.length === 0 ? (
          <div className="text-center py-10">
            <FileText size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No invoices yet</p>
            <p className="text-xs text-gray-300 mt-1">Your first invoice generates automatically at end of month</p>
          </div>
        ) : (
          <div className="space-y-3">
            {periods.map((period) => {
              const cfg = statusConfig[period.status] ?? { label: period.status, classes: 'bg-gray-100 text-gray-600' }
              return (
                <div key={period.id} className="bg-white rounded-xl shadow-sm p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-bold text-[#0A0A0A]">
                          {formatMonthYear(period.period_month, period.period_year)}
                        </p>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', cfg.classes)}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {period.total_units_sold} pairs · {formatCurrency(period.total_revenue)} revenue
                      </p>
                      <p className="text-lg font-bold text-[#22C55E] mt-1">
                        {formatCurrency(period.commission_amount)}
                      </p>
                    </div>
                    <a
                      href={`/api/commissions/${period.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs bg-[#0A0A0A] text-white font-medium px-3 py-1.5 rounded-lg ml-3 shrink-0 mt-0.5"
                    >
                      <FileText size={12} />
                      Invoice
                    </a>
                  </div>

                  {period.status === 'paid' && (
                    <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                      <span>Paid {period.paid_at ? new Date(period.paid_at).toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) : ''}</span>
                      {period.payment_reference && (
                        <span className="font-mono">Ref: {period.payment_reference}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
