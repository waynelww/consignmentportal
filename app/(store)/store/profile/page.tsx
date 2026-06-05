'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { Store, Building2, AlertCircle, FileText, QrCode, User, Lock, Mail, Save, Loader2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { MALAYSIAN_STATES } from '@/lib/utils'
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

  // Tab
  const [tab, setTab] = useState<'store' | 'me'>('store')

  // "Me" form state — editable contact info
  interface MeForm {
    full_name: string
    phone: string
    pic_name: string
    pic_phone: string
    store_email: string
    address: string
    city: string
    state: string
    postcode: string
  }
  const [meForm, setMeForm] = useState<MeForm>({
    full_name: '', phone: '', pic_name: '', pic_phone: '',
    store_email: '', address: '', city: '', state: '', postcode: '',
  })
  const [meDirty, setMeDirty] = useState(false)
  const [savingMe, setSavingMe] = useState(false)
  const [currentEmail, setCurrentEmail] = useState('')

  // Password modal
  const [pwdModalOpen, setPwdModalOpen] = useState(false)
  const [pwdCurrent, setPwdCurrent] = useState('')
  const [pwdNew, setPwdNew] = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [pwdSubmitting, setPwdSubmitting] = useState(false)
  const [pwdShow, setPwdShow] = useState(false)

  // Email modal
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)

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

  // Load editable profile data when entering the Me tab
  useEffect(() => {
    if (tab !== 'me' || !storeId) return
    fetch('/api/profile/me')
      .then((r) => r.json())
      .then((data) => {
        if (!data.profile || !data.store) return
        setMeForm({
          full_name: data.profile.full_name ?? '',
          phone: data.profile.phone ?? '',
          pic_name: data.store.pic_name ?? '',
          pic_phone: data.store.pic_phone ?? '',
          store_email: data.store.email ?? '',
          address: data.store.address ?? '',
          city: data.store.city ?? '',
          state: data.store.state ?? '',
          postcode: data.store.postcode ?? '',
        })
        setCurrentEmail(data.profile.email ?? '')
        setMeDirty(false)
      })
      .catch(() => toast.error('Failed to load profile'))
  }, [tab, storeId])

  function updateMeField<K extends keyof MeForm>(key: K, value: MeForm[K]) {
    setMeForm((prev) => ({ ...prev, [key]: value }))
    setMeDirty(true)
  }

  async function saveMe() {
    setSavingMe(true)
    try {
      const res = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meForm),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      toast.success('Profile updated')
      setMeDirty(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingMe(false)
    }
  }

  async function submitPasswordChange() {
    if (pwdNew.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    if (pwdNew !== pwdConfirm) {
      toast.error('New passwords do not match')
      return
    }
    setPwdSubmitting(true)
    try {
      const res = await fetch('/api/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pwdCurrent, new_password: pwdNew }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      toast.success('Password updated')
      setPwdModalOpen(false)
      setPwdCurrent(''); setPwdNew(''); setPwdConfirm('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setPwdSubmitting(false)
    }
  }

  async function submitEmailChange() {
    if (!newEmail.includes('@')) {
      toast.error('Enter a valid email')
      return
    }
    setEmailSubmitting(true)
    try {
      const res = await fetch('/api/profile/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_email: newEmail }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      toast.success(body.message ?? 'Confirmation email sent', { duration: 8000 })
      setEmailModalOpen(false)
      setNewEmail('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setEmailSubmitting(false)
    }
  }

  const now = getMYNow()
  const currentMonthLabel = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' })

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4">
      <h1 className="text-xl font-bold text-[#0A0A0A]">Info</h1>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-1 flex gap-1">
        <button
          onClick={() => setTab('store')}
          className={cn(
            'flex-1 px-3 py-2 text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors',
            tab === 'store' ? 'bg-[#0A0A0A] text-[#FFD700]' : 'text-gray-600 hover:bg-gray-50',
          )}
        >
          <Store size={14} />
          Store
        </button>
        <button
          onClick={() => setTab('me')}
          className={cn(
            'flex-1 px-3 py-2 text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors',
            tab === 'me' ? 'bg-[#0A0A0A] text-[#FFD700]' : 'text-gray-600 hover:bg-gray-50',
          )}
        >
          <User size={14} />
          Me
        </button>
      </div>

      {tab === 'me' && (
        <div className="space-y-4 pb-4">
          {/* Login & security card */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Lock size={16} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Login & Security</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-gray-400">Email</p>
                <p className="text-sm font-semibold text-gray-800 truncate">{currentEmail || '—'}</p>
              </div>
              <button
                onClick={() => { setNewEmail(''); setEmailModalOpen(true) }}
                className="text-xs font-bold text-[#0A0A0A] bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg shrink-0"
              >
                Change
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-400">Password</p>
                <p className="text-sm font-semibold text-gray-800">••••••••</p>
              </div>
              <button
                onClick={() => { setPwdCurrent(''); setPwdNew(''); setPwdConfirm(''); setPwdModalOpen(true) }}
                className="text-xs font-bold text-[#0A0A0A] bg-[#FFD700] hover:opacity-90 px-3 py-1.5 rounded-lg shrink-0"
              >
                Change Password
              </button>
            </div>
          </div>

          {/* Personal info card */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <User size={16} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your Details</span>
            </div>
            <div className="space-y-3">
              <Field label="Your Name" value={meForm.full_name} onChange={(v) => updateMeField('full_name', v)} />
              <Field label="Your Phone" value={meForm.phone} onChange={(v) => updateMeField('phone', v)} placeholder="01x-xxxxxxx" />
            </div>
          </div>

          {/* Store contact card */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Store size={16} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Store Contact</span>
            </div>
            <div className="space-y-3">
              <Field label="Store Email" value={meForm.store_email} onChange={(v) => updateMeField('store_email', v)} type="email" placeholder="store@example.com" />
              <Field label="PIC Name" value={meForm.pic_name} onChange={(v) => updateMeField('pic_name', v)} />
              <Field label="PIC Phone" value={meForm.pic_phone} onChange={(v) => updateMeField('pic_phone', v)} placeholder="01x-xxxxxxx" />
              <Field label="Address" value={meForm.address} onChange={(v) => updateMeField('address', v)} multiline />
              <div className="grid grid-cols-3 gap-2">
                <Field label="City" value={meForm.city} onChange={(v) => updateMeField('city', v)} />
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide">State</label>
                  <select
                    value={meForm.state}
                    onChange={(e) => updateMeField('state', e.target.value)}
                    className="w-full h-9 px-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  >
                    <option value="">—</option>
                    {MALAYSIAN_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <Field label="Postcode" value={meForm.postcode} onChange={(v) => updateMeField('postcode', v)} />
              </div>
            </div>
          </div>

          {/* What you can't edit */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-900">
              <strong>Commission rate</strong> and <strong>payment cycle</strong> are set by Xocks ops and can't be edited here. WhatsApp ops if you need a change.
            </p>
          </div>

          {/* Save button (sticky-ish at bottom of content) */}
          <button
            onClick={saveMe}
            disabled={!meDirty || savingMe}
            className={cn(
              'w-full h-14 rounded-xl font-bold text-base flex items-center justify-center gap-2',
              !meDirty || savingMe
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-[#0A0A0A] text-[#FFD700] hover:opacity-90 active:scale-95 transition-all',
            )}
          >
            {savingMe ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save size={18} />
                {meDirty ? 'Save Changes' : 'No Changes to Save'}
              </>
            )}
          </button>
        </div>
      )}

      {/* Password modal */}
      {pwdModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !pwdSubmitting && setPwdModalOpen(false)} />
          <div className="relative bg-white rounded-t-2xl w-full max-w-lg px-5 pt-5 pb-6 shadow-2xl mb-[72px]">
            <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-gray-300" /></div>
            <h3 className="text-base font-bold text-[#0A0A0A] mb-4">Change Password</h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Current Password</label>
                <input
                  type={pwdShow ? 'text' : 'password'}
                  value={pwdCurrent}
                  onChange={(e) => setPwdCurrent(e.target.value)}
                  className="w-full h-11 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">New Password</label>
                <input
                  type={pwdShow ? 'text' : 'password'}
                  value={pwdNew}
                  onChange={(e) => setPwdNew(e.target.value)}
                  className="w-full h-11 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Confirm New Password</label>
                <input
                  type={pwdShow ? 'text' : 'password'}
                  value={pwdConfirm}
                  onChange={(e) => setPwdConfirm(e.target.value)}
                  className={cn(
                    'w-full h-11 px-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]',
                    pwdConfirm && pwdNew !== pwdConfirm ? 'border-red-300' : 'border-gray-200',
                  )}
                  autoComplete="new-password"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={pwdShow} onChange={(e) => setPwdShow(e.target.checked)} className="accent-[#FFD700]" />
                Show passwords
              </label>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setPwdModalOpen(false)} disabled={pwdSubmitting} className="flex-1 h-12 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={submitPasswordChange}
                disabled={pwdSubmitting || !pwdCurrent || pwdNew.length < 8 || pwdNew !== pwdConfirm}
                className="flex-1 h-12 rounded-xl bg-[#0A0A0A] text-[#FFD700] text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {pwdSubmitting && <Loader2 size={14} className="animate-spin" />}
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email change modal */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !emailSubmitting && setEmailModalOpen(false)} />
          <div className="relative bg-white rounded-t-2xl w-full max-w-lg px-5 pt-5 pb-6 shadow-2xl mb-[72px]">
            <div className="flex justify-center mb-3"><div className="w-10 h-1 rounded-full bg-gray-300" /></div>
            <h3 className="text-base font-bold text-[#0A0A0A] mb-1">Change Login Email</h3>
            <p className="text-xs text-gray-500 mb-4">
              We'll send a confirmation link to your new email. Click it to complete the change.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Current Email</label>
                <input type="email" value={currentEmail} disabled className="w-full h-11 px-3 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">New Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new@example.com"
                  className="w-full h-11 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEmailModalOpen(false)} disabled={emailSubmitting} className="flex-1 h-12 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={submitEmailChange}
                disabled={emailSubmitting || !newEmail.includes('@')}
                className="flex-1 h-12 rounded-xl bg-[#0A0A0A] text-[#FFD700] text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {emailSubmitting && <Loader2 size={14} className="animate-spin" />}
                Send Confirmation
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'store' && (
        <>
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
        </>
      )}
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  multiline?: boolean
}
function Field({ label, value, onChange, type = 'text', placeholder, multiline }: FieldProps) {
  return (
    <div>
      <label className="text-[10px] text-gray-400 uppercase tracking-wide block mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-9 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
        />
      )}
    </div>
  )
}
