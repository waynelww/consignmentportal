'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Receipt, CalendarDays, Stethoscope, UserRound, Paperclip, X, Lock, LogOut, ArrowLeft, Briefcase } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  CLAIM_CATEGORIES, LEAVE_TYPES, countLeaveDays, daysLabel, rm,
  type ClaimCategory, type LeaveBalance, type LeaveType,
} from '@/lib/hr/rules'
import type { HrClaim, HrHoliday, HrLeave, HrMember, HrPenalty, HrRestDayWork } from '@/lib/hr/types'
import {
  StatusBadge, FileLink, uploadHrFile, fmtDate, fmtRange, inputClass, labelClass, cardClass, primaryButton,
} from '@/components/hr/shared'
import { todayMYT } from '@/lib/sales/last-sale'

// Staff HR link. Three steps, each checked on the server:
//   link password → pick your name → your PIN (or create one) → your page.
// Nothing here uses an XCMS account; see lib/hr/portal-session.ts.

interface MyHr {
  member: HrMember
  year: number
  entitlement: { source: 'statutory' | 'custom'; years_of_service: number | null }
  balances: { annual: LeaveBalance; mc: LeaveBalance; replacement: LeaveBalance }
  work: HrRestDayWork[]
  claims: HrClaim[]
  leaves: HrLeave[]
  penalties: HrPenalty[]
  holidays: HrHoliday[]
  work_days: number[]
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'locked' }
  | { kind: 'pick' }
  | { kind: 'in'; member: { id: string; name: string } }

const FILE_BASE = '/api/hr-portal'

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

export default function StaffHrPage() {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    const res = await fetch('/api/hr-portal/session')
    const body = await res.json().catch(() => ({}))
    if (!body.gate) setStage({ kind: 'locked' })
    else if (body.member) setStage({ kind: 'in', member: body.member })
    else setStage({ kind: 'pick' })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function signOut() {
    await fetch('/api/hr-portal/logout', { method: 'POST' })
    setStage({ kind: 'pick' })
  }

  return (
    <div className="min-h-full bg-[#F5F5F5]">
      <header className="bg-[#0A0A0A] px-4 py-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[#FFD700] font-black text-xl tracking-tight">XOCKS</span>
          <span className="text-white/50 text-xs font-medium">HR</span>
        </div>
        {stage.kind === 'in' && (
          <button onClick={signOut} className="flex items-center gap-1.5 text-xs font-medium text-white/70 hover:text-white">
            <LogOut size={14} /> Sign out
          </button>
        )}
      </header>
      <main className="p-4 sm:p-6">
        {stage.kind === 'loading' && <div className="p-8 text-center text-sm text-gray-400">Loading…</div>}
        {stage.kind === 'locked' && <Unlock onDone={refresh} />}
        {stage.kind === 'pick' && <PickAndPin onIn={(member) => setStage({ kind: 'in', member })} onLocked={refresh} />}
        {stage.kind === 'in' && <MyHrView name={stage.member.name} onSignedOut={() => setStage({ kind: 'pick' })} />}
      </main>
    </div>
  )
}

function Unlock({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!password) return
    setBusy(true)
    const { ok, data } = await postJson('/api/hr-portal/unlock', { password })
    setBusy(false)
    if (!ok) return toast.error(String(data.error ?? 'Wrong password'))
    onDone()
  }
  return (
    <div className={cn(cardClass, 'max-w-sm mx-auto p-6 mt-10 space-y-4')}>
      <div className="text-center">
        <Lock size={28} className="mx-auto text-gray-300 mb-2" />
        <h1 className="text-lg font-bold text-gray-900">Xocks HR</h1>
        <p className="text-sm text-gray-500">Enter the HR password to continue.</p>
      </div>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Password"
        className={inputClass}
      />
      <button onClick={submit} disabled={busy || !password} className={cn(primaryButton, 'w-full')}>
        {busy && <Loader2 size={14} className="animate-spin" />} Continue
      </button>
    </div>
  )
}

interface PickMember { id: string; name: string; has_pin: boolean; has_join_date: boolean }

function PickAndPin({ onIn, onLocked }: { onIn: (m: { id: string; name: string }) => void; onLocked: () => void }) {
  const [members, setMembers] = useState<PickMember[] | null>(null)
  const [chosen, setChosen] = useState<PickMember | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetch('/api/hr-portal/members').then(async (res) => {
      if (res.status === 401) return onLocked()
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(body.error ?? 'Could not load names')
      setMembers(body.members ?? [])
    })
  }, [onLocked])

  if (chosen) return <PinStep member={chosen} onBack={() => setChosen(null)} onIn={onIn} />
  if (adding) return <AddName onBack={() => setAdding(false)} onIn={onIn} />

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Who are you?</h1>
        <p className="text-sm text-gray-500 mt-0.5">Pick your name, then enter your PIN.</p>
      </div>
      <div className={cn(cardClass, 'p-4')}>
        {!members ? (
          <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No names yet. Add yours below.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => setChosen(m)}
                className="flex items-center gap-2 px-3 py-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-800 hover:border-[#FFD700] hover:bg-[#FFD700]/10 transition-colors text-left"
              >
                <UserRound size={16} className="text-gray-400 flex-shrink-0" />
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">
            <Plus size={16} /> My name isn&apos;t here
          </button>
        </div>
      </div>
    </div>
  )
}

function PinInput({ value, onChange, onEnter, autoFocus, placeholder }: {
  value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean; placeholder?: string
}) {
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={6}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      placeholder={placeholder ?? '4–6 digits'}
      className={cn(inputClass, 'text-center text-lg tracking-[0.4em]')}
    />
  )
}

function JoinDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={labelClass}>When did you join Xocks?</label>
      <input type="date" value={value} max={todayMYT()} min="1990-01-01" onChange={(e) => onChange(e.target.value)} className={inputClass} />
      <p className="text-xs text-gray-400 mt-1">Your annual leave and MC are worked out from this, at least the legal minimum.</p>
    </div>
  )
}

function PinStep({ member, onBack, onIn }: { member: PickMember; onBack: () => void; onIn: (m: { id: string; name: string }) => void }) {
  const creating = !member.has_pin
  const askJoinDate = creating && !member.has_join_date
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [joinDate, setJoinDate] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!/^\d{4,6}$/.test(pin)) return toast.error('PIN must be 4 to 6 digits')
    if (creating && pin !== confirmPin) return toast.error('The two PINs don’t match')
    if (askJoinDate && !joinDate) return toast.error('Enter the date you joined Xocks')
    setBusy(true)
    const { ok, data } = await postJson('/api/hr-portal/login', { member_id: member.id, pin, join_date: askJoinDate ? joinDate : null })
    setBusy(false)
    if (!ok) {
      setPin('')
      setConfirmPin('')
      return toast.error(String(data.error ?? 'Could not sign in'))
    }
    if (creating) toast.success('PIN created. Remember it for next time.')
    onIn(data.member as { id: string; name: string })
  }

  return (
    <div className={cn(cardClass, 'max-w-sm mx-auto p-6 mt-6 space-y-4')}>
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800">
        <ArrowLeft size={14} /> Not {member.name}
      </button>
      <div>
        <h1 className="text-lg font-bold text-gray-900">{member.name}</h1>
        <p className="text-sm text-gray-500">
          {creating ? 'First time here. Create a PIN only you know. You’ll use it every time.' : 'Enter your PIN.'}
        </p>
      </div>
      <PinInput value={pin} onChange={setPin} onEnter={creating ? undefined : submit} autoFocus />
      {creating && <PinInput value={confirmPin} onChange={setConfirmPin} onEnter={askJoinDate ? undefined : submit} placeholder="Type it again" />}
      {askJoinDate && <JoinDateInput value={joinDate} onChange={setJoinDate} />}
      <button onClick={submit} disabled={busy} className={cn(primaryButton, 'w-full')}>
        {busy && <Loader2 size={14} className="animate-spin" />} {creating ? 'Create PIN' : 'Sign in'}
      </button>
      {!creating && <p className="text-xs text-gray-400 text-center">Forgot your PIN? Ask the admin to reset it.</p>}
    </div>
  )
}

function AddName({ onBack, onIn }: { onBack: () => void; onIn: (m: { id: string; name: string }) => void }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [joinDate, setJoinDate] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return toast.error('Enter your name')
    if (!/^\d{4,6}$/.test(pin)) return toast.error('PIN must be 4 to 6 digits')
    if (pin !== confirmPin) return toast.error('The two PINs don’t match')
    if (!joinDate) return toast.error('Enter the date you joined Xocks')
    setBusy(true)
    const { ok, data } = await postJson('/api/hr-portal/members', { name: name.trim(), pin, join_date: joinDate })
    setBusy(false)
    if (!ok) return toast.error(String(data.error ?? 'Could not add your name'))
    toast.success(`Welcome, ${name.trim()}`)
    onIn(data.member as { id: string; name: string })
  }

  return (
    <div className={cn(cardClass, 'max-w-sm mx-auto p-6 mt-6 space-y-4')}>
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800">
        <ArrowLeft size={14} /> Back to names
      </button>
      <h1 className="text-lg font-bold text-gray-900">Add your name</h1>
      <div>
        <label className={labelClass}>Full name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Create a PIN (4–6 digits)</label>
        <PinInput value={pin} onChange={setPin} />
      </div>
      <div>
        <label className={labelClass}>Type the PIN again</label>
        <PinInput value={confirmPin} onChange={setConfirmPin} placeholder="" />
      </div>
      <JoinDateInput value={joinDate} onChange={setJoinDate} />
      <button onClick={submit} disabled={busy} className={cn(primaryButton, 'w-full')}>
        {busy && <Loader2 size={14} className="animate-spin" />} Add me
      </button>
    </div>
  )
}

type Tab = 'claim' | 'leave' | 'mc' | 'work'

function MyHrView({ name, onSignedOut }: { name: string; onSignedOut: () => void }) {
  const [data, setData] = useState<MyHr | null>(null)
  const [tab, setTab] = useState<Tab | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/hr-portal/me')
    if (res.status === 401) {
      toast.error('Signed out. Enter your PIN again.')
      return onSignedOut()
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(body.error ?? 'Could not load your HR records')
    setData(body as MyHr)
  }, [onSignedOut])

  useEffect(() => { load() }, [load])

  async function cancel(kind: 'claim' | 'leave' | 'work', id: string) {
    if (!confirm('Cancel this request?')) return
    const res = await fetch(`/api/hr-portal/requests/${kind}/${id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(body.error ?? 'Could not cancel')
    toast.success('Cancelled')
    load()
  }

  const thisMonth = todayMYT().slice(0, 7)
  const penaltiesThisMonth = data?.penalties.filter((p) => p.penalty_date.startsWith(thisMonth)) ?? []
  const pendingClaims = data?.claims.filter((c) => c.status === 'pending') ?? []
  const today = todayMYT()
  const upcomingHolidays = data?.holidays.filter((h) => h.holiday_date >= today).slice(0, 5) ?? []
  const holidaySet = useMemo(() => new Set(data?.holidays.map((h) => h.holiday_date) ?? []), [data])

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-gray-900">Hi, {name}</h1>

      {!data ? (
        <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <>
          {!data.member.join_date && <JoinDatePrompt onDone={load} />}

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard
              label={`Annual leave left (${data.year})`}
              value={`${fmtDays(data.balances.annual.remaining)} / ${fmtDays(data.balances.annual.entitled)}`}
              sub={[
                data.balances.annual.pending ? `${daysLabel(data.balances.annual.pending)} pending` : null,
                data.entitlement.source === 'statutory' && data.entitlement.years_of_service !== null
                  ? `${data.entitlement.years_of_service} yr${data.entitlement.years_of_service === 1 ? '' : 's'} service`
                  : null,
              ].filter(Boolean).join(' · ') || undefined}
            />
            <StatCard
              label={`MC left (${data.year})`}
              value={`${fmtDays(data.balances.mc.remaining)} / ${fmtDays(data.balances.mc.entitled)}`}
              sub={data.balances.mc.pending ? `${daysLabel(data.balances.mc.pending)} pending` : undefined}
            />
            <StatCard
              label="Claims waiting approval"
              value={rm(pendingClaims.reduce((s, c) => s + c.amount, 0))}
              sub={`${pendingClaims.length} claim${pendingClaims.length === 1 ? '' : 's'}`}
            />
            <StatCard
              label="Penalties this month"
              value={rm(penaltiesThisMonth.reduce((s, p) => s + p.amount, 0))}
              sub={`${penaltiesThisMonth.filter((p) => p.kind === 'late').length} late`}
              warn={penaltiesThisMonth.length > 0}
            />
            <StatCard
              label="Replacement days left"
              value={fmtDays(data.balances.replacement.remaining)}
              sub={`${fmtDays(data.balances.replacement.entitled)} earned from rest-day work`}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ActionButton icon={Receipt} label="Submit claim" active={tab === 'claim'} onClick={() => setTab(tab === 'claim' ? null : 'claim')} />
            <ActionButton icon={CalendarDays} label="Apply leave" active={tab === 'leave'} onClick={() => setTab(tab === 'leave' ? null : 'leave')} />
            <ActionButton icon={Stethoscope} label="Submit MC" active={tab === 'mc'} onClick={() => setTab(tab === 'mc' ? null : 'mc')} />
            <ActionButton icon={Briefcase} label="Worked rest day" active={tab === 'work'} onClick={() => setTab(tab === 'work' ? null : 'work')} />
          </div>

          {tab === 'claim' && <ClaimForm onDone={() => { setTab(null); load() }} />}
          {(tab === 'leave' || tab === 'mc') && (
            <LeaveForm
              key={tab}
              mode={tab}
              workDays={data.work_days}
              holidays={holidaySet}
              replacementLeft={data.balances.replacement.remaining}
              onDone={() => { setTab(null); load() }}
            />
          )}
          {tab === 'work' && <WorkForm onDone={() => { setTab(null); load() }} />}

          <Section title="My claims">
            {data.claims.length === 0 ? <Empty text="No claims yet." /> : (
              <ul className="divide-y divide-gray-50">
                {data.claims.map((c) => (
                  <li key={c.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{rm(c.amount)} · {CLAIM_CATEGORIES[c.category]}</p>
                      <p className="text-xs text-gray-500 truncate">{fmtDate(c.claim_date)} · {c.description}</p>
                      {c.review_note && <p className="text-xs text-gray-500 mt-0.5">Note: {c.review_note}</p>}
                    </div>
                    <RowActions status={c.status} kind="claim" id={c.id} hasFile={!!c.receipt_path} onCancel={cancel} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="My leave and MC">
            {data.leaves.length === 0 ? <Empty text="No leave or MC yet." /> : (
              <ul className="divide-y divide-gray-50">
                {data.leaves.map((l) => (
                  <li key={l.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{LEAVE_TYPES[l.leave_type]} · {daysLabel(l.days)}</p>
                      <p className="text-xs text-gray-500 truncate">{fmtRange(l.start_date, l.end_date, l.half_day)}{l.reason ? ` · ${l.reason}` : ''}</p>
                      {l.review_note && <p className="text-xs text-gray-500 mt-0.5">Note: {l.review_note}</p>}
                    </div>
                    <RowActions status={l.status} kind="leave" id={l.id} hasFile={!!l.attachment_path} onCancel={cancel} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {data.work.length > 0 && (
            <Section title="My rest-day and holiday work">
              <ul className="divide-y divide-gray-50">
                {data.work.map((w) => (
                  <li key={w.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{w.event_name} · earns {daysLabel(w.days_earned)}</p>
                      <p className="text-xs text-gray-500">{fmtDate(w.work_date)} · {w.day_kind === 'public_holiday' ? 'Public holiday' : 'Rest day'}{w.note ? ` · ${w.note}` : ''}</p>
                      {w.review_note && <p className="text-xs text-gray-500 mt-0.5">Note: {w.review_note}</p>}
                    </div>
                    <RowActions status={w.status} kind="work" id={w.id} hasFile={false} onCancel={cancel} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="grid lg:grid-cols-2 gap-5">
            <Section title="My penalties">
              {data.penalties.length === 0 ? <Empty text="No penalties. Keep it up." /> : (
                <ul className="divide-y divide-gray-50">
                  {data.penalties.map((p) => (
                    <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {p.kind === 'late' ? `Late${p.minutes_late ? ` ${p.minutes_late} min` : ''}` : 'Penalty'}
                        </p>
                        <p className="text-xs text-gray-500">{fmtDate(p.penalty_date)}{p.note ? ` · ${p.note}` : ''}</p>
                      </div>
                      <span className="text-sm font-semibold text-red-600">−{rm(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Upcoming public holidays">
              {upcomingHolidays.length === 0 ? <Empty text="None listed yet." /> : (
                <ul className="divide-y divide-gray-50">
                  {upcomingHolidays.map((h) => (
                    <li key={h.id} className="px-4 py-3 flex items-center justify-between">
                      <span className="text-sm text-gray-900">{h.name}</span>
                      <span className="text-xs text-gray-500">{fmtDate(h.holiday_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  )
}

function ClaimForm({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState(todayMYT())
  const [category, setCategory] = useState<ClaimCategory>('transport')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    const value = Number(amount)
    if (!(value > 0)) return toast.error('Enter the amount')
    if (!description.trim()) return toast.error('Say what the claim is for')
    if (!file) return toast.error('Attach a photo of the receipt')
    setSaving(true)
    try {
      const uploaded = await uploadHrFile(file)
      const { ok, data } = await postJson('/api/hr-portal/requests', {
        kind: 'claim', claim_date: date, category, amount: value, description, ...uploaded,
      })
      if (!ok) throw new Error(String(data.error ?? 'Could not submit'))
      toast.success('Claim submitted')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormCard title="Submit a claim">
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Date of expense</label>
          <input type="date" value={date} max={todayMYT()} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as ClaimCategory)} className={inputClass}>
            {Object.entries(CLAIM_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Amount (RM)</label>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>What is it for?</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Grab to Sunway Pyramid for stock delivery" className={inputClass} />
      </div>
      <FilePicker label="Receipt photo" file={file} onChange={setFile} />
      <button onClick={submit} disabled={saving} className={cn(primaryButton, 'w-full sm:w-auto')}>
        {saving && <Loader2 size={14} className="animate-spin" />} Submit claim
      </button>
    </FormCard>
  )
}

function LeaveForm({ mode, workDays, holidays, replacementLeft, onDone }: {
  mode: 'leave' | 'mc'
  workDays: number[]
  holidays: Set<string>
  replacementLeft: number
  onDone: () => void
}) {
  const [type, setType] = useState<LeaveType>(mode === 'mc' ? 'mc' : 'annual')
  const [start, setStart] = useState(todayMYT())
  const [end, setEnd] = useState(todayMYT())
  const [halfDay, setHalfDay] = useState(false)
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const days = useMemo(
    () => countLeaveDays(start, end < start ? start : end, { halfDay: halfDay && start === end, workDays, holidays }),
    [start, end, halfDay, workDays, holidays],
  )

  async function submit() {
    if (end < start) return toast.error('End date is before start date')
    if (days === 0) return toast.error('Those dates are all weekends or public holidays')
    if (type === 'mc' && !file) return toast.error('Attach a photo of the MC slip')
    setSaving(true)
    try {
      const uploaded = file ? await uploadHrFile(file) : {}
      const { ok, data } = await postJson('/api/hr-portal/requests', {
        kind: 'leave', leave_type: type, start_date: start, end_date: end,
        half_day: halfDay && start === end, reason: reason.trim() || null, ...uploaded,
      })
      if (!ok) throw new Error(String(data.error ?? 'Could not submit'))
      toast.success(type === 'mc' ? 'MC submitted' : 'Leave applied')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormCard title={mode === 'mc' ? 'Submit MC' : 'Apply for leave'}>
      {mode === 'leave' && (
        <div>
          <label className={labelClass}>Type</label>
          <div className="flex flex-wrap gap-2">
            {(['annual', 'emergency', 'unpaid', ...(replacementLeft > 0 ? ['replacement' as const] : [])] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-sm',
                  type === t ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                )}
              >
                {LEAVE_TYPES[t]}
              </button>
            ))}
          </div>
          {type === 'emergency' && <p className="text-xs text-gray-500 mt-1">Emergency leave is taken from your annual leave.</p>}
          {type === 'replacement' && <p className="text-xs text-gray-500 mt-1">You have {daysLabel(replacementLeft)} of replacement leave from rest-day work.</p>}
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <label className={labelClass}>From</label>
          <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>To</label>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </div>
        <label className={cn('flex items-center gap-2 text-sm text-gray-700 py-2', start !== end && 'opacity-40')}>
          <input type="checkbox" checked={halfDay && start === end} disabled={start !== end} onChange={(e) => setHalfDay(e.target.checked)} />
          Half day
        </label>
      </div>
      <p className="text-sm text-gray-700">
        <strong>{daysLabel(days)}</strong> <span className="text-gray-500">(weekends and public holidays not counted)</span>
      </p>
      <div>
        <label className={labelClass}>{mode === 'mc' ? 'Clinic / notes (optional)' : 'Reason (optional)'}</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={inputClass} />
      </div>
      <FilePicker label={mode === 'mc' ? 'MC slip photo' : 'Supporting document (optional)'} file={file} onChange={setFile} />
      <button onClick={submit} disabled={saving} className={cn(primaryButton, 'w-full sm:w-auto')}>
        {saving && <Loader2 size={14} className="animate-spin" />} {mode === 'mc' ? 'Submit MC' : 'Apply'}
      </button>
    </FormCard>
  )
}

function WorkForm({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState(todayMYT())
  const [eventName, setEventName] = useState('')
  const [halfDay, setHalfDay] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!eventName.trim()) return toast.error('Say which event or job')
    setSaving(true)
    const { ok, data } = await postJson('/api/hr-portal/requests', {
      kind: 'work', work_date: date, half_day: halfDay, event_name: eventName.trim(), note: note.trim() || null,
    })
    setSaving(false)
    if (!ok) return toast.error(String(data.error ?? 'Could not submit'))
    toast.success('Logged. Once approved it becomes replacement leave.')
    onDone()
  }

  return (
    <FormCard title="Worked on a rest day or public holiday">
      <p className="text-xs text-gray-500">
        Log a weekend or public holiday you worked (booth event, store run). Once approved you earn a replacement day off.
      </p>
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <label className={labelClass}>Date worked</label>
          <input type="date" value={date} max={todayMYT()} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Event / job</label>
          <input value={eventName} onChange={(e) => setEventName(e.target.value)} maxLength={120} placeholder="Mid Valley booth" className={inputClass} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
        Half day only (earns half a day)
      </label>
      <div>
        <label className={labelClass}>Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputClass} />
      </div>
      <button onClick={submit} disabled={saving} className={cn(primaryButton, 'w-full sm:w-auto')}>
        {saving && <Loader2 size={14} className="animate-spin" />} Log work
      </button>
    </FormCard>
  )
}

function JoinDatePrompt({ onDone }: { onDone: () => void }) {
  const [joinDate, setJoinDate] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!joinDate) return toast.error('Enter the date you joined Xocks')
    setSaving(true)
    const { ok, data } = await postJson('/api/hr-portal/join-date', { join_date: joinDate })
    setSaving(false)
    if (!ok) return toast.error(String(data.error ?? 'Could not save'))
    toast.success('Saved. Your leave is now worked out from your join date.')
    onDone()
  }
  return (
    <div className={cn(cardClass, 'p-4 space-y-3 border-[#FFD700]')}>
      <h2 className="text-sm font-semibold text-gray-900">One quick question</h2>
      <JoinDateInput value={joinDate} onChange={setJoinDate} />
      <button onClick={save} disabled={saving} className={primaryButton}>
        {saving && <Loader2 size={14} className="animate-spin" />} Save
      </button>
    </div>
  )
}

function FilePicker({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {file ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm">
          <Paperclip size={14} className="text-gray-400" />
          <span className="truncate flex-1">{file.name}</span>
          <button onClick={() => onChange(null)} className="text-gray-400 hover:text-gray-700"><X size={14} /></button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-2 px-3 py-3 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 cursor-pointer hover:bg-gray-50">
          <Paperclip size={14} /> Take photo or choose file
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              if (f && f.size > 10 * 1024 * 1024) return toast.error('File is over 10 MB')
              onChange(f)
            }}
          />
        </label>
      )}
    </div>
  )
}

function RowActions({ status, kind, id, hasFile, onCancel }: {
  status: string
  kind: 'claim' | 'leave' | 'work'
  id: string
  hasFile: boolean
  onCancel: (kind: 'claim' | 'leave' | 'work', id: string) => void
}) {
  return (
    <div className="flex flex-col items-end gap-1 flex-shrink-0">
      <StatusBadge status={status} />
      <div className="flex gap-3">
        {hasFile && kind !== 'work' && <FileLink kind={kind} id={id} base={FILE_BASE} />}
        {status === 'pending' && (
          <button onClick={() => onCancel(kind, id)} className="text-xs font-medium text-gray-500 hover:text-red-600">Cancel</button>
        )}
      </div>
    </div>
  )
}

function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function StatCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn(cardClass, 'p-4')}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn('text-lg font-bold mt-1', warn ? 'text-red-600' : 'text-gray-900')}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function ActionButton({ icon: Icon, label, active, onClick }: { icon: typeof Receipt; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col sm:flex-row items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition-colors',
        active ? 'bg-[#0A0A0A] text-[#FFD700] border-[#0A0A0A]' : 'bg-white text-gray-800 border-gray-200 hover:border-[#FFD700]',
      )}
    >
      <Icon size={18} /> {label}
    </button>
  )
}

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cn(cardClass, 'p-4 space-y-3')}>
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cardClass}>
      <h2 className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">{title}</h2>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-sm text-gray-400">{text}</p>
}
