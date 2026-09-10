'use client'

import { useEffect, useState } from 'react'
import styles from '../speed.module.css'

interface AdminEntry {
  id: number
  name: string
  phone: string
  gender: 'M' | 'F'
  speed: number
  created_at: string
}

const CODE_KEY = 'speed-admin-code'

// Game-master console: unlock once with the shared access code (remembered
// on this device), then key in results from any phone/laptop. Every action
// hits /api/speed/admin, which re-checks the code server-side.
export function SpeedAdmin() {
  const [code, setCode] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [entries, setEntries] = useState<AdminEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState<'M' | 'F'>('M')
  const [speed, setSpeed] = useState('')

  const call = async (payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    try {
      const res = await fetch('/api/speed/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 401) {
          setUnlocked(false)
          try { localStorage.removeItem(CODE_KEY) } catch {}
        }
        setMsg({ text: data.error || 'Something went wrong. Try again.', ok: false })
        return false
      }
      setEntries(data.entries ?? [])
      return true
    } catch {
      setMsg({ text: 'No connection — check the internet and try again.', ok: false })
      return false
    } finally {
      setBusy(false)
    }
  }

  // Auto-unlock if this device already knows the code.
  useEffect(() => {
    let saved = ''
    try { saved = localStorage.getItem(CODE_KEY) ?? '' } catch {}
    if (!saved) return
    setCode(saved)
    call({ action: 'list', code: saved }).then((ok) => {
      if (ok) setUnlocked(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unlock = async () => {
    if (!code.trim()) return
    setMsg(null)
    const ok = await call({ action: 'list', code: code.trim() })
    if (ok) {
      setUnlocked(true)
      try { localStorage.setItem(CODE_KEY, code.trim()) } catch {}
    }
  }

  const submit = async () => {
    const s = parseFloat(speed)
    if (!name.trim()) { setMsg({ text: 'Enter the runner’s name.', ok: false }); return }
    if (phone.trim() && phone.replace(/\D/g, '').length < 4) {
      setMsg({ text: 'Phone number needs at least 4 digits.', ok: false }); return
    }
    if (!(s > 0 && s <= 35)) { setMsg({ text: 'Enter a speed between 1 and 35 km/h.', ok: false }); return }
    const ok = await call({
      action: 'submit', code, name: name.trim(), phone: phone.trim(), gender, speed: s,
    })
    if (ok) {
      setMsg({ text: 'Submitted! Board updated on all screens.', ok: true })
      setName(''); setPhone(''); setSpeed('')
    }
  }

  const remove = async (id: number, entryName: string) => {
    if (!confirm(`Delete ${entryName}?`)) return
    const ok = await call({ action: 'delete', code, id })
    if (ok) setMsg({ text: 'Removed — all screens updated.', ok: true })
  }

  const clearAll = async () => {
    if (!confirm('Delete ALL results? This cannot be undone.')) return
    const ok = await call({ action: 'clear', code })
    if (ok) setMsg({ text: 'Board cleared.', ok: true })
  }

  const exportCsv = () => {
    const q = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = ['Name,Phone,Category,Speed (km/h),Time']
    for (const e of entries) {
      lines.push([q(e.name), q(e.phone), e.gender === 'M' ? 'Men' : 'Women', e.speed, q(e.created_at)].join(','))
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    a.download = 'beat-the-speed-results.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const message = msg && (
    <p className={`${styles.msg} ${msg.ok ? styles.msgOk : styles.msgErr}`}>{msg.text}</p>
  )

  if (!unlocked) {
    return (
      <section className={styles.panel} aria-label="Admin login">
        <h2 className={styles.panelTitle}>GAME MASTER LOGIN</h2>
        <p className={styles.hint}>Enter the access code to key in results.</p>
        <div className={styles.field}>
          <label htmlFor="fCode">Access code</label>
          <input
            id="fCode" type="password" autoComplete="off" value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && unlock()}
          />
        </div>
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" onClick={unlock} disabled={busy}>
            <span>ENTER</span>
          </button>
        </div>
        {message}
      </section>
    )
  }

  return (
    <section className={styles.panel} aria-label="Key in result">
      <h2 className={styles.panelTitle}>KEY IN RESULT</h2>
      <p className={styles.hint}>
        Enter a runner&apos;s best speed and hit submit — the board updates on every screen within seconds.
      </p>
      <div className={styles.field}>
        <label htmlFor="fName">Name</label>
        <input id="fName" type="text" maxLength={30} autoComplete="off" placeholder="e.g. AIMAN"
          value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="fPhone">Phone number (board shows last 4 digits only)</label>
        <input id="fPhone" type="tel" maxLength={20} autoComplete="off" placeholder="e.g. 012-345 6789"
          value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="fGender">Category</label>
        <select id="fGender" value={gender} onChange={(e) => setGender(e.target.value as 'M' | 'F')}>
          <option value="M">Men</option>
          <option value="F">Women</option>
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="fSpeed">Speed achieved (km/h)</label>
        <input id="fSpeed" type="number" step="0.1" min="1" max="35" placeholder="e.g. 18.5"
          value={speed} onChange={(e) => setSpeed(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </div>
      <div className={styles.actions}>
        <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" onClick={submit} disabled={busy}>
          <span>SUBMIT RESULT</span>
        </button>
      </div>
      {message}

      <div className={styles.entryList}>
        <h3>All entries</h3>
        {entries.length === 0 && <div className={styles.entry} style={{ opacity: 0.5 }}>No entries yet.</div>}
        {entries.map((e) => (
          <div key={e.id} className={styles.entry}>
            <span className={`${styles.entryG} ${e.gender === 'M' ? styles.entryGM : styles.entryGF}`}>
              {e.gender}
            </span>
            <span className={styles.entryN}>
              {e.name}
              {e.phone ? ` · ${e.phone}` : ''}
            </span>
            <span className={styles.entryS}>{e.speed.toFixed(1)} km/h</span>
            <button className={styles.entryDel} type="button" onClick={() => remove(e.id, e.name)}
              aria-label={`Delete ${e.name}`} disabled={busy}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className={styles.actions} style={{ marginTop: 16 }}>
        <button className={`${styles.btn} ${styles.btnDark}`} type="button" onClick={exportCsv}>
          <span>EXPORT CSV</span>
        </button>
        <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={clearAll} disabled={busy}>
          <span>CLEAR ALL</span>
        </button>
      </div>
    </section>
  )
}
