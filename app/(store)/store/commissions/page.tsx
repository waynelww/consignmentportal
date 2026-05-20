'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Info } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMonthYear } from '@/lib/utils'
import type { CommissionPeriod, Profile, Sale, Store } from '@/types'
import { cn } from '@/lib/utils'

function getMYNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
}

export default function CommissionsPage() {
  const [periods, setPeriods] = useState<CommissionPeriod[]>([])
  const [currentMonthSales, setCurrentMonthSales] = useState(0)
  const [currentMonthRevenue, setCurrentMonthRevenue] = useState(0)
  const [currentMonthCommission, setCurrentMonthCommission] = useState(0)
  const [commissionRate, setCommissionRate] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('store_id')
        .eq('id', user.id)
        .single<Profile>()

      if (!profile?.store_id) { setLoading(false); return }

      const now = getMYNow()
      const thisMonth = now.getMonth() + 1
      const thisYear = now.getFullYear()
      const pad = (n: number) => String(n).padStart(2, '0')
      const firstOfMonth = `${thisYear}-${pad(thisMonth)}-01`

      const [storeRes, periodsRes, salesRes] = await Promise.all([
        supabase.from('stores').select('commission_rate').eq('id', profile.store_id).single<Pick<Store, 'commission_rate'>>(),
        supabase
          .from('commission_periods')
          .select('*')
          .eq('store_id', profile.store_id)
          .order('period_year', { ascending: false })
          .order('period_month', { ascending: false }),
        supabase
          .from('sales')
          .select('quantity, total_amount, commission_amount')
          .eq('store_id', profile.store_id)
          .gte('sale_date', firstOfMonth),
      ])

      setCommissionRate(storeRes.data?.commission_rate ?? 0)
      setPeriods((periodsRes.data as CommissionPeriod[]) ?? [])

      const sales = (salesRes.data as Pick<Sale, 'quantity' | 'total_amount' | 'commission_amount'>[]) ?? []
      setCurrentMonthSales(sales.reduce((s, x) => s + x.quantity, 0))
      setCurrentMonthRevenue(sales.reduce((s, x) => s + x.total_amount, 0))
      setCurrentMonthCommission(sales.reduce((s, x) => s + x.commission_amount, 0))
      setLoading(false)
    }
    load()
  }, [])

  const now = getMYNow()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const payoutMonth = nextMonth.toLocaleString('en-MY', { month: 'long', year: 'numeric' })
  const currentMonthLabel = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' })

  const statusConfig: Record<string, { label: string; classes: string }> = {
    pending: { label: 'Pending', classes: 'bg-amber-100 text-amber-700' },
    approved: { label: 'Approved', classes: 'bg-blue-100 text-blue-700' },
    paid: { label: 'Paid', classes: 'bg-green-100 text-green-700' },
    disputed: { label: 'Disputed', classes: 'bg-red-100 text-red-600' },
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-bold text-[#0A0A0A]">Commissions</h1>

      {/* Current month card */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm p-5 animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-10 bg-gray-200 rounded w-2/3" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
      ) : (
        <div className="bg-[#0A0A0A] rounded-xl p-5">
          <p className="text-gray-400 text-xs mb-1">{currentMonthLabel}</p>
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
              Estimated payout: End of {currentMonthLabel}
            </p>
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2">
        <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800">
          Every sale you record earns you <strong>{commissionRate}% commission</strong>. Payouts are processed on the{' '}
          <strong>5th of the following month</strong>.
        </p>
      </div>

      {/* Past payouts */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Past Payouts</h2>

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
          <p className="text-center text-gray-400 py-10">No past payout records yet.</p>
        ) : (
          <div className="space-y-3">
            {periods.map((period) => {
              const cfg = statusConfig[period.status] ?? { label: period.status, classes: 'bg-gray-100 text-gray-600' }
              return (
                <div key={period.id} className="bg-white rounded-xl shadow-sm p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#0A0A0A]">
                        {formatMonthYear(period.period_month, period.period_year)}
                      </p>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-gray-500">
                          {period.total_units_sold} pairs · {formatCurrency(period.total_revenue)} revenue
                        </p>
                        <p className="text-base font-bold text-[#22C55E]">
                          {formatCurrency(period.commission_amount)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 ml-3 shrink-0">
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', cfg.classes)}>
                        {cfg.label}
                      </span>
                      {period.pdf_url && (
                        <a
                          href={`/api/commissions/${period.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-[#0A0A0A] font-medium underline"
                        >
                          Statement
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>

                  {period.payment_reference && (
                    <p className="mt-2 text-xs text-gray-400 font-mono">
                      Ref: {period.payment_reference}
                    </p>
                  )}
                  {period.paid_at && (
                    <p className="mt-1 text-xs text-gray-400">
                      Paid on {new Date(period.paid_at).toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
                    </p>
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
