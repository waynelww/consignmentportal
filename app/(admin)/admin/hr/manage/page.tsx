'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, X, Loader2, Trash2, Download, Send, Banknote, ShieldAlert, Copy, KeyRound, HardDrive } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { CLAIM_CATEGORIES, LEAVE_TYPES, completedYears, daysLabel, entitlementsFor, rm } from '@/lib/hr/rules'
import type { HrClaim, HrHoliday, HrLeave, HrMember, HrPenalty, HrRestDayWork } from '@/lib/hr/types'
import type { HrSettings } from '@/lib/hr/settings'
import { StatusBadge, FileLink, fmtDate, fmtRange, inputClass, labelClass, cardClass, primaryButton } from '@/components/hr/shared'
import { monthLabel, shiftMonth } from '@/lib/monthly-report/months'
import { todayMYT } from '@/lib/sales/last-sale'
import { AUDIT_ACTIONS } from '@/lib/hr/audit-labels'

interface AdminData {
  month: string
  members: (HrMember & { has_pin: boolean })[]
  pending_claims: HrClaim[]
  pending_leaves: HrLeave[]
  claims: HrClaim[]
  leaves: HrLeave[]
  penalties: HrPenalty[]
  holidays: HrHoliday[]
  settings: HrSettings
  pending_work: HrRestDayWork[]
  work: HrRestDayWork[]
}

const TABS = [
  { key: 'approvals', label: 'Approvals' },
  { key: 'month', label: 'Monthly records' },
  { key: 'penalties', label: 'Late penalties' },
  { key: 'staff', label: 'Staff & entitlements' },
  { key: 'holidays', label: 'Public holidays' },
  { key: 'activity', label: 'Activity log' },
  { key: 'settings', label: 'Report & settings' },
] as const
type TabKey = (typeof TABS)[number]['key']

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

async function call(url: string, method: string, body?: unknown): Promise<boolean> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    toast.error(json.error ?? 'Something went wrong')
    return false
  }
  return true
}

export default function HrAdminPage() {
  const [tab, setTab] = useState<TabKey>('approvals')

  // Google sends the admin back with ?tab=settings&drive=<result> after Connect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t && TABS.some((x) => x.key === t)) setTab(t as TabKey)
    const drive = params.get('drive')
    if (drive === 'connected') toast.success('Google Drive connected')
    else if (drive === 'drive-box-not-ticked') {
      toast.error('Not connected: on Google’s screen, tick the box for Google Drive files, then Continue.', { duration: 10000 })
    } else if (drive) toast.error(`Google Drive not connected (${drive})`)
    if (t || drive) window.history.replaceState(null, '', window.location.pathname)
  }, [])
  const [month, setMonth] = useState(todayMYT().slice(0, 7))
  const [data, setData] = useState<AdminData | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/admin?month=${month}`)
    const body = await res.json().catch(() => ({}))
    if (res.status === 403) return setForbidden(true)
    if (!res.ok) return toast.error(body.error ?? 'Could not load HR data')
    setData(body as AdminData)
  }, [month])

  useEffect(() => { load() }, [load])

  if (forbidden) {
    return (
      <div className={cn(cardClass, 'max-w-md mx-auto p-8 text-center')}>
        <ShieldAlert size={32} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-600">HR Admin is for the owner account only. Staff submit claims, leave and MC on the HR link: <a href="/hr" className="font-medium underline">/hr</a>.</p>
      </div>
    )
  }
  if (!data) return <div className="p-8 text-center text-sm text-gray-400">Loading…</div>

  const nameOf = new Map(data.members.map((m) => [m.id, m.name]))
  const pendingCount = data.pending_claims.length + data.pending_leaves.length + data.pending_work.length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">HR Admin</h1>
        <p className="text-sm text-gray-500 mt-0.5">Approve claims, leave and MC, log late penalties, and send the monthly HR report.</p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px',
              tab === t.key ? 'border-[#0A0A0A] text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {t.label}
            {t.key === 'approvals' && pendingCount > 0 && (
              <span className="ml-1.5 text-[10px] font-bold bg-[#FFD700] text-[#0A0A0A] rounded-full px-1.5 py-0.5">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {(tab === 'month' || tab === 'penalties') && (
        <MonthPicker month={month} onChange={setMonth} />
      )}

      {tab === 'approvals' && <Approvals data={data} nameOf={nameOf} reload={load} />}
      {tab === 'month' && <MonthRecords data={data} nameOf={nameOf} reload={load} />}
      {tab === 'penalties' && <Penalties data={data} nameOf={nameOf} reload={load} />}
      {tab === 'staff' && <Staff members={data.members} reload={load} />}
      {tab === 'holidays' && <Holidays holidays={data.holidays} reload={load} />}
      {tab === 'activity' && <Activity members={data.members} />}
      {tab === 'settings' && <SettingsPanel settings={data.settings} reload={load} />}
    </div>
  )
}

function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(shiftMonth(month, -1))} className="px-2 py-1 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">‹</button>
      <span className="text-sm font-semibold text-gray-900 w-36 text-center">{monthLabel(month)}</span>
      <button onClick={() => onChange(shiftMonth(month, 1))} className="px-2 py-1 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">›</button>
    </div>
  )
}

function ReviewButtons({ kind, id, reload, allowReject = true }: { kind: 'claim' | 'leave' | 'work'; id: string; reload: () => void; allowReject?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function act(action: 'approve' | 'reject') {
    let note: string | null = null
    if (action === 'reject') {
      note = prompt('Reason for rejecting (shown to the staff member):')
      if (note === null) return
    }
    setBusy(true)
    if (await call(`/api/hr/requests/${kind}/${id}`, 'PATCH', { action, note })) {
      toast.success(action === 'approve' ? 'Approved' : 'Rejected')
      reload()
    }
    setBusy(false)
  }
  return (
    <div className="flex gap-1">
      <button disabled={busy} onClick={() => act('approve')} title="Approve" className="w-8 h-8 rounded-lg flex items-center justify-center text-green-600 hover:bg-green-50 disabled:opacity-40">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={16} />}
      </button>
      {allowReject && (
        <button disabled={busy} onClick={() => act('reject')} title="Reject" className="w-8 h-8 rounded-lg flex items-center justify-center text-red-600 hover:bg-red-50 disabled:opacity-40">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

function Approvals({ data, nameOf, reload }: { data: AdminData; nameOf: Map<string, string>; reload: () => void }) {
  if (data.pending_claims.length + data.pending_leaves.length + data.pending_work.length === 0) {
    return <div className={cn(cardClass, 'p-10 text-center text-sm text-gray-500')}>Nothing waiting. All caught up.</div>
  }
  return (
    <div className="space-y-5">
      {data.pending_claims.length > 0 && (
        <Table title={`Claims (${data.pending_claims.length})`} head={['Staff', 'Date', 'Category', 'Description', 'Amount', 'Receipt', '']}>
          {data.pending_claims.map((c) => (
            <tr key={c.id} className="border-b border-gray-50 last:border-b-0">
              <Td strong>{nameOf.get(c.member_id)}</Td>
              <Td>{fmtDate(c.claim_date)}</Td>
              <Td>{CLAIM_CATEGORIES[c.category]}</Td>
              <Td>{c.description}</Td>
              <Td strong>{rm(c.amount)}</Td>
              <Td>{c.receipt_path ? <FileLink kind="claim" id={c.id} /> : '—'}</Td>
              <Td><ReviewButtons kind="claim" id={c.id} reload={reload} /></Td>
            </tr>
          ))}
        </Table>
      )}
      {data.pending_leaves.length > 0 && (
        <Table title={`Leave & MC (${data.pending_leaves.length})`} head={['Staff', 'Type', 'Dates', 'Days', 'Reason', 'Slip', '']}>
          {data.pending_leaves.map((l) => (
            <tr key={l.id} className="border-b border-gray-50 last:border-b-0">
              <Td strong>{nameOf.get(l.member_id)}</Td>
              <Td>{LEAVE_TYPES[l.leave_type]}</Td>
              <Td>{fmtRange(l.start_date, l.end_date, l.half_day)}</Td>
              <Td>{daysLabel(l.days)}</Td>
              <Td>{l.reason ?? '—'}</Td>
              <Td>{l.attachment_path ? <FileLink kind="leave" id={l.id} /> : '—'}</Td>
              <Td><ReviewButtons kind="leave" id={l.id} reload={reload} /></Td>
            </tr>
          ))}
        </Table>
      )}

      {data.pending_work.length > 0 && (
        <Table title={`Rest-day and holiday work (${data.pending_work.length})`} head={['Staff', 'Date', 'Day', 'Event / job', 'Earns', 'Note', '']}>
          {data.pending_work.map((w) => (
            <tr key={w.id} className="border-b border-gray-50 last:border-b-0">
              <Td strong>{nameOf.get(w.member_id)}</Td>
              <Td>{fmtDate(w.work_date)}</Td>
              <Td>{w.day_kind === 'public_holiday' ? 'Public holiday' : 'Rest day'}</Td>
              <Td>{w.event_name}</Td>
              <Td>{daysLabel(w.days_earned)} replacement</Td>
              <Td>{w.note ?? '—'}</Td>
              <Td><ReviewButtons kind="work" id={w.id} reload={reload} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

function MonthRecords({ data, nameOf, reload }: { data: AdminData; nameOf: Map<string, string>; reload: () => void }) {
  async function markPaid(id: string) {
    if (await call(`/api/hr/requests/claim/${id}`, 'PATCH', { action: 'paid' })) {
      toast.success('Marked as paid')
      reload()
    }
  }
  const approvedTotal = data.claims.filter((c) => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + c.amount, 0)
  return (
    <div className="space-y-5">
      <Table title={`Claims — ${rm(approvedTotal)} approved`} head={['Staff', 'Date', 'Category', 'Description', 'Amount', 'Status', '']}>
        {data.claims.length === 0 ? <EmptyRow cols={7} /> : data.claims.map((c) => (
          <tr key={c.id} className="border-b border-gray-50 last:border-b-0">
            <Td strong>{nameOf.get(c.member_id)}</Td>
            <Td>{fmtDate(c.claim_date)}</Td>
            <Td>{CLAIM_CATEGORIES[c.category]}</Td>
            <Td>{c.description}{c.review_note ? <span className="block text-xs text-gray-400">Note: {c.review_note}</span> : null}</Td>
            <Td strong>{rm(c.amount)}</Td>
            <Td><StatusBadge status={c.status} /></Td>
            <Td>
              <div className="flex items-center gap-2 justify-end">
                {c.receipt_path && <FileLink kind="claim" id={c.id} label="Receipt" />}
                {c.drive_url && <a href={c.drive_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:underline">Drive</a>}
                {c.status === 'approved' && (
                  <button onClick={() => markPaid(c.id)} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                    <Banknote size={12} /> Mark paid
                  </button>
                )}
                {c.status === 'pending' && <ReviewButtons kind="claim" id={c.id} reload={reload} />}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      <Table title="Rest-day and holiday work" head={['Staff', 'Date', 'Day', 'Event / job', 'Earns', 'Status', '']}>
        {data.work.length === 0 ? <EmptyRow cols={7} /> : data.work.map((w) => (
          <tr key={w.id} className="border-b border-gray-50 last:border-b-0">
            <Td strong>{nameOf.get(w.member_id)}</Td>
            <Td>{fmtDate(w.work_date)}</Td>
            <Td>{w.day_kind === 'public_holiday' ? 'Public holiday' : 'Rest day'}</Td>
            <Td>{w.event_name}{w.review_note ? <span className="block text-xs text-gray-400">Note: {w.review_note}</span> : null}</Td>
            <Td>{daysLabel(w.days_earned)}</Td>
            <Td><StatusBadge status={w.status} /></Td>
            <Td>{w.status === 'pending' && <ReviewButtons kind="work" id={w.id} reload={reload} />}</Td>
          </tr>
        ))}
      </Table>
      <Table title="Leave & MC" head={['Staff', 'Type', 'Dates', 'Days', 'Reason', 'Status', '']}>
        {data.leaves.length === 0 ? <EmptyRow cols={7} /> : data.leaves.map((l) => (
          <tr key={l.id} className="border-b border-gray-50 last:border-b-0">
            <Td strong>{nameOf.get(l.member_id)}</Td>
            <Td>{LEAVE_TYPES[l.leave_type]}</Td>
            <Td>{fmtRange(l.start_date, l.end_date, l.half_day)}</Td>
            <Td>{daysLabel(l.days)}</Td>
            <Td>{l.reason ?? '—'}</Td>
            <Td><StatusBadge status={l.status} /></Td>
            <Td>
              <div className="flex items-center gap-2 justify-end">
                {l.attachment_path && <FileLink kind="leave" id={l.id} label="Slip" />}
                {l.drive_url && <a href={l.drive_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:underline">Drive</a>}
                {l.status === 'pending' && <ReviewButtons kind="leave" id={l.id} reload={reload} />}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function Penalties({ data, nameOf, reload }: { data: AdminData; nameOf: Map<string, string>; reload: () => void }) {
  const active = data.members.filter((m) => m.active)
  const [memberId, setMemberId] = useState('')
  const [date, setDate] = useState(todayMYT())
  const [kind, setKind] = useState<'late' | 'other'>('late')
  const [minutes, setMinutes] = useState('')
  const [amount, setAmount] = useState(String(data.settings.latePenalty))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!memberId) return toast.error('Pick a staff member')
    setSaving(true)
    const ok = await call('/api/hr/penalties', 'POST', {
      member_id: memberId, penalty_date: date, kind,
      minutes_late: kind === 'late' && minutes ? Number(minutes) : null,
      amount: Number(amount) || 0, note: note.trim() || null,
    })
    setSaving(false)
    if (ok) {
      toast.success('Penalty logged')
      setMinutes('')
      setNote('')
      reload()
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this penalty?')) return
    if (await call(`/api/hr/penalties?id=${id}`, 'DELETE')) {
      toast.success('Deleted')
      reload()
    }
  }

  const total = data.penalties.reduce((s, p) => s + p.amount, 0)
  return (
    <div className="space-y-5">
      <div className={cn(cardClass, 'p-4 space-y-3')}>
        <h2 className="text-sm font-semibold text-gray-900">Log a penalty</h2>
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className={labelClass}>Staff</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={inputClass}>
              <option value="">Choose…</option>
              {active.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as 'late' | 'other')} className={inputClass}>
              <option value="late">Late</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Minutes late</label>
            <input type="number" min="1" value={minutes} disabled={kind !== 'late'} onChange={(e) => setMinutes(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Amount (RM)</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional)" className={inputClass} />
          <button onClick={submit} disabled={saving} className={primaryButton}>
            {saving && <Loader2 size={14} className="animate-spin" />} Log penalty
          </button>
        </div>
      </div>
      <Table title={`Penalties — ${rm(total)}`} head={['Staff', 'Date', 'Type', 'Minutes', 'Amount', 'Note', '']}>
        {data.penalties.length === 0 ? <EmptyRow cols={7} /> : data.penalties.map((p) => (
          <tr key={p.id} className="border-b border-gray-50 last:border-b-0">
            <Td strong>{nameOf.get(p.member_id)}</Td>
            <Td>{fmtDate(p.penalty_date)}</Td>
            <Td>{p.kind === 'late' ? 'Late' : 'Other'}</Td>
            <Td>{p.minutes_late ?? '—'}</Td>
            <Td strong>{rm(p.amount)}</Td>
            <Td>{p.note ?? '—'}</Td>
            <Td>
              <button onClick={() => remove(p.id)} title="Delete" className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function Staff({ members, reload }: { members: (HrMember & { has_pin: boolean })[]; reload: () => void }) {
  return (
    <Table
      title="Staff, PINs and yearly entitlements"
      note="Annual leave and MC follow the Employment Act 1955 minimums from each join date (8/12/16 and 14/18/22 days for under 2, 2–5 and 5+ years; annual leave pro-rated in the joining year). Turn on Custom to give someone more. Staff enter their own join date on the HR link. Resetting a PIN signs that person out everywhere."
      head={['Staff', 'PIN', 'Joined', `Annual ${new Date().getFullYear()}`, `MC ${new Date().getFullYear()}`, 'Custom', '']}
    >
      {members.filter((m) => m.active).map((m) => <StaffRow key={m.id} member={m} reload={reload} />)}
    </Table>
  )
}

function StaffRow({ member, reload }: { member: HrMember & { has_pin: boolean }; reload: () => void }) {
  const [joinDate, setJoinDate] = useState(member.join_date ?? '')
  const [custom, setCustom] = useState(member.custom_entitlement)
  const [annual, setAnnual] = useState(String(member.annual_leave_days))
  const [mc, setMc] = useState(String(member.mc_days))
  const year = new Date().getFullYear()
  const today = todayMYT()
  const preview = entitlementsFor(
    { join_date: joinDate || null, custom_entitlement: custom, annual_leave_days: Number(annual), mc_days: Number(mc) },
    year,
  )
  const dirty = (joinDate || null) !== member.join_date || custom !== member.custom_entitlement
    || (custom && (Number(annual) !== member.annual_leave_days || Number(mc) !== member.mc_days))

  async function save() {
    const body: Record<string, unknown> = { custom_entitlement: custom }
    if (joinDate && joinDate !== member.join_date) body.join_date = joinDate
    if (custom) {
      body.annual_leave_days = Number(annual)
      body.mc_days = Number(mc)
    }
    if (await call(`/api/hr/members/${member.id}`, 'PATCH', body)) {
      toast.success(`Saved ${member.name}`)
      reload()
    }
  }
  async function resetPin() {
    if (!confirm(`Reset ${member.name}'s PIN? They'll be signed out and set a new PIN next time.`)) return
    if (await call(`/api/hr/members/${member.id}`, 'PATCH', { reset_pin: true })) {
      toast.success(`${member.name}'s PIN reset`)
      reload()
    }
  }
  const usingCustom = preview.source === 'custom'
  return (
    <tr className="border-b border-gray-50 last:border-b-0">
      <Td strong>{member.name}</Td>
      <Td>
        {member.has_pin ? (
          <button onClick={resetPin} className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-red-600">
            <KeyRound size={12} /> Set · Reset
          </button>
        ) : (
          <span className="text-xs text-gray-400">Not set yet</span>
        )}
      </Td>
      <Td>
        <input type="date" value={joinDate} max={today} onChange={(e) => setJoinDate(e.target.value)} className={cn(inputClass, 'w-40')} />
        <span className="block text-xs text-gray-400 mt-0.5">
          {joinDate ? `${completedYears(joinDate, today)} yr service` : 'Not given yet'}
        </span>
      </Td>
      <Td>
        {custom ? (
          <input type="number" min="0" max="60" step="0.5" value={annual} onChange={(e) => setAnnual(e.target.value)} className={cn(inputClass, 'w-20')} />
        ) : (
          <span>{preview.annual} days{usingCustom && <span className="block text-xs text-amber-600">No join date: using {member.annual_leave_days}</span>}</span>
        )}
      </Td>
      <Td>
        {custom ? (
          <input type="number" min="0" max="60" step="0.5" value={mc} onChange={(e) => setMc(e.target.value)} className={cn(inputClass, 'w-20')} />
        ) : (
          <span>{preview.mc} days</span>
        )}
      </Td>
      <Td>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> More than the law
        </label>
      </Td>
      <Td>{dirty && <button onClick={save} className="text-xs font-semibold text-blue-600 hover:underline">Save</button>}</Td>
    </tr>
  )
}

function Holidays({ holidays, reload }: { holidays: HrHoliday[]; reload: () => void }) {
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  async function add() {
    if (!date || !name.trim()) return toast.error('Enter a date and a name')
    if (await call('/api/hr/holidays', 'POST', { holiday_date: date, name: name.trim() })) {
      setDate('')
      setName('')
      reload()
    }
  }
  async function remove(id: string) {
    if (await call(`/api/hr/holidays?id=${id}`, 'DELETE')) reload()
  }
  return (
    <div className="space-y-5">
      <div className={cn(cardClass, 'p-4 flex flex-col sm:flex-row gap-3 sm:items-end')}>
        <div>
          <label className={labelClass}>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div className="flex-1">
          <label className={labelClass}>Holiday</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Christmas Day" className={inputClass} />
        </div>
        <button onClick={add} className={primaryButton}>Add holiday</button>
      </div>
      <Table title="Public holidays (this year onward)" note="Leave already submitted keeps the day count it was submitted with." head={['Date', 'Holiday', '']}>
        {holidays.length === 0 ? <EmptyRow cols={3} /> : holidays.map((h) => (
          <tr key={h.id} className="border-b border-gray-50 last:border-b-0">
            <Td>{fmtDate(h.holiday_date)}</Td>
            <Td strong>{h.name}</Td>
            <Td>
              <button onClick={() => remove(h.id)} title="Delete" className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function SettingsPanel({ settings, reload }: { settings: HrSettings; reload: () => void }) {
  const [email, setEmail] = useState(settings.email ?? '')
  const [penalty, setPenalty] = useState(String(settings.latePenalty))
  const [workDays, setWorkDays] = useState<number[]>(settings.workDays)
  const [reportMonth, setReportMonth] = useState(shiftMonth(todayMYT().slice(0, 7), -1))
  const [sending, setSending] = useState(false)
  const [linkPassword, setLinkPassword] = useState('')
  const link = typeof window === 'undefined' ? '/hr' : `${window.location.origin}/hr`

  async function saveLinkPassword() {
    if (linkPassword.length < 6) return toast.error('Use at least 6 characters')
    if (!confirm('Change the HR link password? Everyone will need the new password.')) return
    if (await call('/api/hr/settings', 'PUT', { portal_password: linkPassword })) {
      toast.success('Link password changed')
      setLinkPassword('')
    }
  }

  async function save() {
    if (await call('/api/hr/settings', 'PUT', { email: email.trim(), late_penalty: Number(penalty) || 0, work_days: workDays })) {
      toast.success('Settings saved')
      reload()
    }
  }

  async function sendTest() {
    setSending(true)
    const res = await fetch(`/api/hr/report?month=${reportMonth}`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setSending(false)
    if (!res.ok) return toast.error(body.details ?? body.error ?? 'Send failed')
    toast.success(`Report sent to ${body.to}`)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className={cn(cardClass, 'p-4 space-y-3 lg:col-span-2')}>
        <h2 className="text-sm font-semibold text-gray-900">Staff HR link</h2>
        <p className="text-xs text-gray-500">Share this with staff. They enter the link password, pick their name and type their own PIN. No XCMS account needed.</p>
        <div className="flex gap-2">
          <input readOnly value={link} className={cn(inputClass, 'font-mono')} />
          <button
            onClick={() => { navigator.clipboard.writeText(link).then(() => toast.success('Link copied'), () => toast.error('Copy failed')) }}
            className={cn(primaryButton, 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50')}
          >
            <Copy size={14} /> Copy
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <label className={labelClass}>Change link password (everyone will need the new one)</label>
            <input type="password" value={linkPassword} onChange={(e) => setLinkPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
          </div>
          <button onClick={saveLinkPassword} className={primaryButton}>Change password</button>
        </div>
      </div>
      <div className={cn(cardClass, 'p-4 space-y-3')}>
        <h2 className="text-sm font-semibold text-gray-900">Monthly HR report</h2>
        <p className="text-xs text-gray-500">Emailed on the 1st of every month at 10:00 for the month before: claims, penalties, leave and MC per person, with an Excel file.</p>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={reportMonth} onChange={setReportMonth} />
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/hr/report?month=${reportMonth}`} className={cn(primaryButton, 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50')}>
            <Download size={14} /> Download Excel
          </a>
          <button onClick={sendTest} disabled={sending} className={primaryButton}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Email it now
          </button>
        </div>
      </div>
      <div className={cn(cardClass, 'p-4 space-y-3')}>
        <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
        <div>
          <label className={labelClass}>Send the monthly report to</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Default late penalty (RM)</label>
          <input type="number" min="0" step="0.01" value={penalty} onChange={(e) => setPenalty(e.target.value)} className={cn(inputClass, 'w-32')} />
        </div>
        <div>
          <label className={labelClass}>Working days (for counting leave)</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => {
              const n = i + 1
              const on = workDays.includes(n)
              return (
                <button
                  key={d}
                  onClick={() => setWorkDays(on ? workDays.filter((x) => x !== n) : [...workDays, n].sort())}
                  className={cn('px-2.5 py-1 rounded-lg border text-xs font-medium', on ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-gray-200 text-gray-500')}
                >
                  {d}
                </button>
              )
            })}
          </div>
        </div>
        <button onClick={save} className={primaryButton}>Save settings</button>
      </div>
      <DriveCard />
    </div>
  )
}

function DriveCard() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean; account: string | null; pending: number } | null>(null)
  const [copying, setCopying] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/hr/drive')
    if (res.ok) setStatus(await res.json())
  }, [])
  useEffect(() => { load() }, [load])

  async function copyNow() {
    setCopying(true)
    let total = 0
    try {
      // Batches of up to 8 per call (Vercel's time limit); keep going until done.
      for (let i = 0; i < 50; i++) {
        const res = await fetch('/api/hr/drive', { method: 'POST' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Copy failed')
        total += body.copied
        if (body.errors?.length) toast.error(body.errors[0])
        if (body.remaining === 0 || body.stuck) break
      }
      toast.success(`${total} file${total === 1 ? '' : 's'} copied to Google Drive`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Copy failed')
    } finally {
      setCopying(false)
      load()
    }
  }

  async function test() {
    setCopying(true)
    const res = await fetch('/api/hr/drive', { method: 'PUT' })
    const body = await res.json().catch(() => ({}))
    setCopying(false)
    if (!res.ok) return toast.error(body.error ?? 'Test failed')
    toast.success('Drive works. Opening the folder…')
    window.open(body.folder, '_blank', 'noopener')
  }

  async function disconnect() {
    if (!confirm('Disconnect Google Drive? Files already copied stay in Drive.')) return
    if (await call('/api/hr/drive', 'DELETE')) {
      toast.success('Disconnected')
      load()
    }
  }

  return (
    <div className={cn(cardClass, 'p-4 space-y-3 lg:col-span-2')}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><HardDrive size={16} /> Google Drive copies</h2>
      <p className="text-xs text-gray-500">
        When you approve a claim or MC, its receipt or slip is also copied to Google Drive in
        <span className="font-mono"> Xocks HR Receipts / month / name</span>. The app keeps its own copy too.
      </p>
      {!status ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !status.configured ? (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          Not set up yet: add GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in Vercel, redeploy, then come back to connect.
        </p>
      ) : !status.connected ? (
        <div className="space-y-1">
          <a href="/api/hr/drive/connect" className={cn(primaryButton, 'w-fit')}>
            <HardDrive size={14} /> Connect Google Drive
          </a>
          <p className="text-xs text-gray-500">On Google’s screen, make sure the Google Drive box is ticked before you continue.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-700">Connected to <strong>{status.account}</strong></span>
          {status.pending > 0 && (
            <button onClick={copyNow} disabled={copying} className={primaryButton}>
              {copying && <Loader2 size={14} className="animate-spin" />} Copy {status.pending} waiting file{status.pending === 1 ? '' : 's'} now
            </button>
          )}
          <button onClick={test} disabled={copying} className="text-xs font-medium text-blue-600 hover:underline">Test</button>
          <button onClick={disconnect} className="text-xs font-medium text-gray-500 hover:text-red-600">Disconnect</button>
        </div>
      )}
    </div>
  )
}

interface AuditEntry {
  id: string
  created_at: string
  actor_type: 'staff' | 'admin' | 'visitor'
  actor_label: string
  action: string
  details: Record<string, unknown> | null
  ip: string | null
  user_agent: string | null
}

function deviceOf(ua: string | null): string {
  if (!ua) return '—'
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other'
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : ''
  return browser ? `${os} · ${browser}` : os
}

function detailText(e: AuditEntry, nameOf: Map<string, string>): string {
  const d = e.details ?? {}
  const parts: string[] = []
  if (typeof d.for_member_id === 'string' && e.actor_type === 'admin') parts.push(`for ${nameOf.get(d.for_member_id) ?? '?'}`)
  if (typeof d.amount === 'number') parts.push(rm(d.amount))
  if (typeof d.leave_type === 'string') parts.push(LEAVE_TYPES[d.leave_type as keyof typeof LEAVE_TYPES] ?? d.leave_type)
  if (typeof d.start_date === 'string' && typeof d.end_date === 'string') parts.push(fmtRange(d.start_date, d.end_date))
  if (typeof d.claim_date === 'string') parts.push(fmtDate(d.claim_date))
  if (typeof d.work_date === 'string') parts.push(`${fmtDate(d.work_date)}${d.event_name ? ` ${d.event_name}` : ''}`)
  if (typeof d.join_date === 'string') parts.push(`joined ${fmtDate(d.join_date)}`)
  if (typeof d.to === 'string' && e.action === 'join_date.changed') parts.push(`joined ${fmtDate(d.to)}`)
  if (typeof d.penalty_date === 'string') parts.push(fmtDate(d.penalty_date))
  if (typeof d.holiday_date === 'string') parts.push(`${fmtDate(d.holiday_date)}${d.name ? ` ${d.name}` : ''}`)
  if (typeof d.note === 'string' && d.note) parts.push(`“${d.note}”`)
  if (typeof d.month === 'string') parts.push(monthLabel(d.month))
  return parts.join(' · ')
}

function Activity({ members }: { members: HrMember[] }) {
  const [memberId, setMemberId] = useState('')
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const nameOf = new Map(members.map((m) => [m.id, m.name]))

  useEffect(() => {
    setEntries(null)
    fetch(`/api/hr/activity?limit=300${memberId ? `&member_id=${memberId}` : ''}`)
      .then((r) => r.json())
      .then((b) => setEntries(b.entries ?? []))
      .catch(() => toast.error('Could not load the activity log'))
  }, [memberId])

  return (
    <div className="space-y-3">
      <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={cn(inputClass, 'max-w-xs')}>
        <option value="">Everyone</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <Table
        title="Activity log"
        note="Every sign-in, wrong password or PIN, submission and admin change, newest first, with the device it came from."
        head={['When', 'Who', 'What', 'Details', 'Device']}
      >
        {!entries ? (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">Loading…</td></tr>
        ) : entries.length === 0 ? (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No activity yet.</td></tr>
        ) : entries.map((e) => (
          <tr key={e.id} className="border-b border-gray-50 last:border-b-0">
            <Td>
              <span className="whitespace-nowrap">
                {new Date(e.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </Td>
            <Td strong>{e.actor_label}</Td>
            <Td>
              <span className={cn(e.action.endsWith('failed') && 'text-red-600 font-medium')}>{AUDIT_ACTIONS[e.action] ?? e.action}</span>
            </Td>
            <Td>{detailText(e, nameOf) || '—'}</Td>
            <Td><span className="whitespace-nowrap" title={`${e.ip ?? ''} ${e.user_agent ?? ''}`}>{deviceOf(e.user_agent)}</span></Td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function Table({ title, note, head, children }: { title: string; note?: string; head: string[]; children: React.ReactNode }) {
  return (
    <div className={cn(cardClass, 'overflow-hidden')}>
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {note && <p className="text-xs text-gray-500 mt-0.5">{note}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {head.map((h, i) => <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  )
}

function Td({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <td className={cn('px-4 py-3 align-top', strong ? 'font-medium text-gray-900' : 'text-gray-600')}>{children}</td>
}

function EmptyRow({ cols }: { cols: number }) {
  return <tr><td colSpan={cols} className="px-4 py-6 text-center text-sm text-gray-400">Nothing this month.</td></tr>
}
