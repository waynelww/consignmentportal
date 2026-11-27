'use client'

// Event page → Part-timers. One pos_staff record per person, reused across
// events (typing a name suggests people from past events; they keep their
// PIN). PINs are never shown again after they are set — only a freshly
// generated/reset PIN is shown once so the admin can WhatsApp it.

import { useCallback, useEffect, useState } from 'react'
import { UserPlus, X, KeyRound, EyeOff, Eye, Trash2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface StaffRow { id: string; name: string; phone: string | null; hidden: boolean; has_pin: boolean; sales: number }
interface Suggestion { id: string; name: string; phone: string | null; past_events: string[] }

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]'

export function PartTimersSection({ eventId, isActive, onChange }: { eventId: string; isActive: boolean; onChange?: () => void }) {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [shownPin, setShownPin] = useState<{ name: string; pin: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/staff`)
    const body = await res.json().catch(() => ({}))
    if (res.ok) setStaff(body.staff ?? [])
    setLoading(false)
  }, [eventId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const q = name.trim()
    if (!adding || q.length < 1) { setSuggestions([]); return }
    const t = setTimeout(() => {
      fetch(`/api/pos-staff/search?q=${encodeURIComponent(q)}&event_id=${eventId}`)
        .then((r) => r.json()).then((b) => setSuggestions(b.people ?? [])).catch(() => setSuggestions([]))
    }, 200)
    return () => clearTimeout(t)
  }, [name, adding, eventId])

  function reset() { setAdding(false); setName(''); setPhone(''); setPin(''); setSuggestions([]) }

  async function add(payload: Record<string, unknown>, label: string) {
    setBusy(true)
    const res = await fetch(`/api/events/${eventId}/staff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { toast.error(body.error ?? 'Could not add'); return }
    toast.success(`${label} added`)
    if (body.generated_pin) setShownPin({ name: label, pin: body.generated_pin })
    reset(); load(); onChange?.()
  }

  async function resetPin(s: StaffRow) {
    const typed = prompt(`New 4-digit PIN for ${s.name} (leave blank to generate one). They will be signed out of the POS.`, '')
    if (typed === null) return
    if (typed && !/^\d{4}$/.test(typed)) { toast.error('PIN must be 4 digits'); return }
    const res = await fetch(`/api/events/${eventId}/staff/${s.id}/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: typed }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error ?? 'Could not reset'); return }
    setShownPin({ name: s.name, pin: body.pin }); load()
  }

  async function setHidden(s: StaffRow, hidden: boolean) {
    const res = await fetch(`/api/events/${eventId}/staff/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden }) })
    if (!res.ok) { toast.error('Could not update'); return }
    toast.success(hidden ? `${s.name} hidden from the POS (sales kept)` : `${s.name} is back on the POS`); load(); onChange?.()
  }

  async function remove(s: StaffRow) {
    if (!confirm(`Remove ${s.name} from this event?`)) return
    const res = await fetch(`/api/events/${eventId}/staff/${s.id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error ?? 'Could not remove'); return }
    load(); onChange?.()
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Part-timers</h3>
          <p className="text-xs text-gray-500">Who can sell on this event&apos;s POS link. Each signs in with their own 4-digit PIN.</p>
        </div>
        {isActive && !adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-2 bg-[#0A0A0A] text-white rounded-lg text-xs font-semibold hover:bg-gray-800">
            <UserPlus size={14} /> Add part-timer
          </button>
        )}
      </div>

      {shownPin && (
        <div className="mb-3 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm flex items-center justify-between gap-3">
          <span><b>{shownPin.name}</b>&apos;s PIN: <span className="font-mono text-lg font-bold tracking-widest">{shownPin.pin}</span> <span className="text-xs text-gray-500">— shown once, send it to them now</span></span>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => navigator.clipboard.writeText(`Your Xocks POS PIN: ${shownPin.pin}`).then(() => toast.success('Copied'))} className="p-1.5 text-gray-500 hover:text-gray-900"><Copy size={15} /></button>
            <button onClick={() => setShownPin(null)} className="p-1.5 text-gray-400 hover:text-gray-700"><X size={15} /></button>
          </div>
        </div>
      )}

      {adding && (
        <div className="mb-4 rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="relative">
            <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Type a name — past part-timers show up" />
            {suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {suggestions.map((s) => (
                  <button key={s.id} type="button" disabled={busy} onClick={() => add({ staff_id: s.id }, s.name)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-b-0">
                    <div className="text-sm font-medium text-gray-900">{s.name} <span className="text-xs font-normal text-blue-600">· tap to add (keeps PIN)</span></div>
                    <div className="text-xs text-gray-400">{[s.phone, s.past_events.length ? `Past: ${s.past_events.join(', ')}` : null].filter(Boolean).join(' · ')}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-gray-600 block mb-1">Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="Optional" inputMode="tel" /></div>
            <div><label className="text-xs font-medium text-gray-600 block mb-1">4-digit PIN</label>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} className={cn(inputCls, 'font-mono tracking-widest')} placeholder="Blank = generate" inputMode="numeric" /></div>
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
            <button disabled={busy || !name.trim() || (pin !== '' && pin.length !== 4)}
              onClick={() => add({ name: name.trim(), phone: phone.trim() || null, pin }, name.trim())}
              className="px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
              {busy ? 'Adding…' : 'Add as new person'}
            </button>
          </div>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : staff.length === 0 ? (
        <p className="text-sm text-gray-400">No part-timers yet.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {staff.map((s) => (
            <div key={s.id} className={cn('py-2.5 flex items-center justify-between gap-3', s.hidden && 'opacity-60')}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{s.name} {s.hidden && <span className="text-[10px] font-bold uppercase text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 ml-1">hidden</span>}</p>
                <p className="text-xs text-gray-400">{[s.phone, `${s.sales} sale${s.sales === 1 ? '' : 's'}`, s.has_pin ? 'PIN set' : 'no PIN'].filter(Boolean).join(' · ')}</p>
              </div>
              {isActive && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => resetPin(s)} title="Reset PIN" className="flex items-center gap-1 text-xs border border-gray-200 hover:bg-gray-50 rounded-lg px-2.5 py-1.5"><KeyRound size={13} /> Reset PIN</button>
                  {s.sales > 0 ? (
                    <button onClick={() => setHidden(s, !s.hidden)} className="flex items-center gap-1 text-xs border border-gray-200 hover:bg-gray-50 rounded-lg px-2.5 py-1.5">
                      {s.hidden ? <><Eye size={13} /> Show on POS</> : <><EyeOff size={13} /> Hide from POS</>}
                    </button>
                  ) : (
                    <button onClick={() => remove(s)} title="Remove" className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
