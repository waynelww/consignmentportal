'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { Store, Building2, AlertCircle, FileText, QrCode } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatMonthYear } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Store as StoreType, CommissionPeriod, Sale } from '@/types'
import { useStore } from '@/components/store/StoreContext'

function getMYNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
}

const STATUS_CFG: Record<string, { label: string; classes: string }> = {
  pending:  { label: 'Pending',  classes: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Approved', classes: 'bg-blue-100 text-blue-700' },
  paid:     { label: 'Paid',     classes: 'bg-green-100 text-green-700' },
  disputed: { label: 'Disputed', classes: 'bg-red-100 text-red-600' },
}

export default function InfoPage() {
  const { storeId, store: contextStore } = useStore()
  const [store, setStore]               = useState<StoreType | null>(contextStore)
  const [periods, setPeriods]           = useState<CommissionPeriod[]>([])
  const [mtdSales, setMtdSales]         = useState(0)
  const [mtdRevenue, setMtdRevenue]     = useState(0)
  const [mtdCommission, setMtdCommission] = useState(0)
  const [loading, setLoading]           = useState(true)

  const load = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    const supabase = createClient()

    // storeId + store from context — skip auth waterfall and stores query
    const now = getMYNow()
    const thisMonth = now.getMonth() + 1
    const thisYear  = now.getFullYear()
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

    setStore(contextStore)
    setPeriods((periodsRes.data as CommissionPeriod[]) ?? [])

    const sales = (salesRes.data as Pick<Sale, 'quantity' | 'total_amount' | 'commission_amount'>[]) ?? []
    setMtdSales(sales.reduce((s, x) => s + x.quantity, 0))
    setMtdRevenue(sales.reduce((s, x) => s + x.total_amount, 0))
    setMtdCommission(sales.reduce((s, x) => s + x.commission_amount, 0))

    // Auto-ensure previous month period exists
    const prevMonth = thisMonth === 1 ? 12 : thisMonth - 1
    const prevYear  = thisMonth === 1 ? thisYear - 1 : thisYear
    const exists = (periodsRes.data ?? []).some(
      (p: CommissionPeriod) => p.period_month === prevMonth && p.period_year === prevYear
    )
    if (!exists) {
      fetch('/api/commissions/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: prevMonth, year: prevYear }),
      }).then((res) => {
        if (res.ok && storeId) {
          supabase
            .from('commission_periods')
            .select('*')
            .eq('store_id', storeId)
            .order('period_year', { ascending: false })
            .order('period_month', { ascending: false })
            .then(({ data }) => { if (data) setPeriods(data as CommissionPeriod[]) })
        }
      })
    }

    setLoading(false)
  }, [storeId, contextStore]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const now = getMYNow()
  const currentMonthLabel = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' })

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-bold text-[#0A0A0A]">Info</h1>

      {/* ── Store info ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Store size={16} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Store Info</span>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : (
          ([
            ['Store Name',      store?.store_name],
            ['Store Code',      store?.store_code],
            ['PIC Name',        store?.pic_name],
            ['Phone',           store?.pic_phone],
            ['Address',         [store?.address, store?.city, store?.state, store?.postcode].filter(Boolean).join(', ')],
            ['Commission Rate', store?.commission_rate ? `${store.commission_rate}%` : null],
          ] as [string, string | null | undefined][]).map(([label, value]) => value ? (
            <div key={label} className="flex items-start justify-between gap-4">
              <span className="text-xs text-gray-400 shrink-0 w-28">{label}</span>
              <span className="text-sm text-gray-800 text-right">{value}</span>
            </div>
          ) : null)
        )}
      </div>

      {/* ── Pay the balance to ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden shadow-lg" style={{ background: 'linear-gradient(160deg, #111 0%, #1a1a1a 100%)', border: '1px solid #2a2a2a' }}>
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-[#D4AC3A]" />
            <span className="text-xs font-bold text-[#D4AC3A] uppercase tracking-widest">Pay Balance To</span>
          </div>
          <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Wayne Group Holding</span>
        </div>

        {/* Warning banner */}
        <div className="mx-5 mb-4 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle size={13} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-300/90 leading-relaxed">
            Pay before the <strong className="text-amber-300">7th of each month</strong>. Use your store code as reference.{' '}
            <strong className="text-red-400">Late payments incur a 10% surcharge.</strong>
          </p>
        </div>

        {/* QR code + bank details side by side */}
        <div className="px-5 pb-5 flex gap-4 items-stretch">
          {/* QR code block */}
          <div className="flex flex-col items-center gap-2 shrink-0">
            <div className="relative rounded-xl overflow-hidden p-2.5 bg-white shadow-[0_0_0_3px_#D4AC3A]" style={{ width: 116, height: 116 }}>
              <Image
                src="/wayne-group-qr.jpg"
                alt="Wayne Group Holding payment QR"
                width={96}
                height={96}
                className="object-contain w-full h-full"
                priority
              />
            </div>
            <div className="flex items-center gap-1">
              <QrCode size={10} className="text-[#D4AC3A]" />
              <span className="text-[10px] font-semibold text-[#D4AC3A] tracking-wider uppercase">Scan to Pay</span>
            </div>
            <span className="text-[9px] text-white/30 -mt-1">DuitNow QR</span>
          </div>

          {/* Divider */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="flex-1 w-px bg-white/10" />
            <span className="text-[9px] text-white/20 font-semibold uppercase tracking-widest rotate-0">or</span>
            <div className="flex-1 w-px bg-white/10" />
          </div>

          {/* Bank details */}
          <div className="flex-1 flex flex-col justify-center gap-2.5 min-w-0">
            {([
              ['Bank',        'CIMB Bank'],
              ['Acc Name',    'WAYNE GROUP HOLDING SDN BHD'],
              ['Acc No.',     '8605806682'],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-[9px] text-white/30 uppercase tracking-wider">{label}</span>
                <span className={cn(
                  'text-white font-semibold leading-tight break-words',
                  label === 'Acc Name' ? 'text-[10px]' : 'text-sm font-mono'
                )}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer: payment reference */}
        <div className="mx-5 mb-5 rounded-lg px-3 py-2.5 flex items-center justify-between"
          style={{ background: 'rgba(212,172,58,0.08)', border: '1px solid rgba(212,172,58,0.2)' }}>
          <span className="text-[11px] text-[#D4AC3A]/70">Payment Reference</span>
          <span className="font-mono font-bold text-[#D4AC3A] text-sm tracking-widest">
            {store?.store_code ?? '—'}
          </span>
        </div>
      </div>

      {/* ── This month live card ───────────────────────────────────────────────── */}
      {loading ? (
        <div className="bg-[#0A0A0A] rounded-xl p-5 animate-pulse space-y-3">
          <div className="h-3 bg-white/10 rounded w-1/3" />
          <div className="h-10 bg-white/10 rounded w-2/3" />
        </div>
      ) : (
        <div className="bg-[#0A0A0A] rounded-xl p-5">
          <p className="text-gray-400 text-xs mb-0.5">{currentMonthLabel} — Live</p>
          <p className="text-sm text-gray-400">Commission earned this month</p>
          <p className="text-4xl font-bold text-[#FFD700] mt-1">{formatCurrency(mtdCommission)}</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-gray-400">Pairs Sold</p>
              <p className="text-xl font-bold text-white">{mtdSales}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Revenue</p>
              <p className="text-sm font-bold text-white">{formatCurrency(mtdRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Rate</p>
              <p className="text-xl font-bold text-[#FFD700]">{store?.commission_rate ?? 0}%</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-gray-400 text-center">
              Invoice auto-generated on the 1st of next month
            </p>
          </div>
        </div>
      )}

      {/* ── Past invoices ──────────────────────────────────────────────────────── */}
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
          <div className="text-center py-8">
            <FileText size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No invoices yet</p>
            <p className="text-xs text-gray-300 mt-1">Your first invoice generates automatically at end of month</p>
          </div>
        ) : (
          <div className="space-y-3">
            {periods.map((period) => {
              const cfg = STATUS_CFG[period.status] ?? { label: period.status, classes: 'bg-gray-100 text-gray-600' }
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
                      <span>
                        Paid {period.paid_at
                          ? new Date(period.paid_at).toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })
                          : ''}
                      </span>
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

      {/* spacer so last card isn't hidden behind nav */}
      <div className="h-2" />
    </div>
  )
}
