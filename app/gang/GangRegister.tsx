'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './gang.module.css'
import type { GangPrize } from '@/lib/gang/prizes'

type Platform = 'shopee' | 'tiktok' | 'website'
type SubmissionStatus = 'pending' | 'valid' | 'invalid'

interface RegisterResult {
  member: { id: string; name: string; email: string | null; created_at?: string; lifetime_code?: string | null }
  submission: {
    id: string
    order_number: string
    platform: Platform
    status: SubmissionStatus
    submitted_date: string
    verified_at: string | null
  }
  prizes: GangPrize[]
  stats: MemberStats | null
  ticket: { ticket_no: number; draw_month: string } | null
  first_timer: { freepair_code: string | null; lifetime_code: string | null } | null
}

// '2026-09' → 'SEPTEMBER'
function drawMonthLabel(drawMonth: string): string {
  const [y, m] = drawMonth.split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleString('en-GB', { month: 'long' }).toUpperCase()
}

interface TicketListResult {
  member: { name: string; lifetime_code: string | null }
  draw_month: string
  tickets: { ticket_no: number; order_number: string; platform: string }[]
  pending_count: number
}

function fmtTicketNo(n: number): string {
  return '#' + String(n).padStart(4, '0')
}

interface MemberStats {
  totalPairs: number
  topProducts: { name: string; pairs: number }[]
}

interface SaveStepResult {
  member: { id: string; name: string; email: string | null; created_at?: string }
  stats: MemberStats | null
}

// Real Xocks logo lockup, per the brand guide's documented "on ink"
// treatment: the black asset inverted to white for dark backgrounds
// rather than maintaining a separate white file.
function XocksLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/xocks-logo.png" alt="Xocks" className={styles.brandLogoImg} height={28} />
  )
}


// Shopify's discount deep-link: opens the store with the code already
// applied to the cart — "redeem" means one tap, not copy-paste-remember.
function redeemUrl(code: string): string {
  return `https://www.xocks.co/discount/${encodeURIComponent(code)}`
}

function ShopeeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 9V7a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2" />
    </svg>
  )
}
function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M14 4v9.5a3 3 0 1 1-2-2.83V4h2z" stroke="#25F4EE" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 4c.3 2 1.8 3.6 4 3.9" stroke="#FE2C55" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function WebsiteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="#fff" strokeWidth="1.6" />
      <path d="M4 12h16M12 4c2.2 2.3 3.3 5 3.3 8s-1.1 5.7-3.3 8c-2.2-2.3-3.3-5-3.3-8s1.1-5.7 3.3-8z" stroke="#fff" strokeWidth="1.4" />
    </svg>
  )
}

const PLATFORMS: { value: Platform; label: string; bg: string; icon: ReactNode }[] = [
  { value: 'shopee', label: 'Shopee', bg: '#EE4D2D', icon: <ShopeeIcon /> },
  { value: 'tiktok', label: 'TikTok Shop', bg: '#000', icon: <TikTokIcon /> },
  { value: 'website', label: 'Website', bg: 'var(--brown)', icon: <WebsiteIcon /> },
]

const STATUS_COPY: Record<SubmissionStatus, { title: string; desc: string; cls: string }> = {
  pending: {
    title: 'Order pending verification',
    desc: "We match order numbers against the day's sales every evening at 6PM — you'll get a WhatsApp ping once it's confirmed.",
    cls: styles.statusPending,
  },
  valid: {
    title: 'Order verified ✓',
    desc: 'Nice — your order is confirmed. Your Grand Draw entry for this month is locked in.',
    cls: styles.statusValid,
  },
  invalid: {
    title: 'Order number not found',
    desc: "We couldn't match this order yet. Email us at info@xocks.co and our team will sort it out.",
    cls: styles.statusInvalid,
  },
}

function maskPhone(phone: string) {
  return '•••• ' + phone.slice(-4)
}

const DEMO_MONTHLY_PRIZES: GangPrize[] = [
  { id: 'demo-1', tier_label: '🏆 FREE 12 Months Custom Socks', probability_text: '12 pairs total', cadence: 'monthly', prize_label: '' },
  { id: 'demo-2', tier_label: '🎁 Mystery Gift', probability_text: 'rolling', cadence: 'monthly', prize_label: '' },
  { id: 'demo-3', tier_label: '🎫 Buy 1 Free 1 Voucher', probability_text: 'rolling', cadence: 'monthly', prize_label: '' },
]

export function GangRegister({ initialPrizes }: { initialPrizes: GangPrize[] }) {
  const [step, setStep] = useState(0)
  const [returning, setReturning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [orderNumber, setOrderNumber] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<RegisterResult | null>(null)
  const [perkCopied, setPerkCopied] = useState<string | null>(null)
  const [returningStats, setReturningStats] = useState<MemberStats | null>(null)
  const [ticketList, setTicketList] = useState<TicketListResult | null>(null)
  const [viewingTickets, setViewingTickets] = useState(false)
  const [loadingTickets, setLoadingTickets] = useState(false)

  const [timer, setTimer] = useState('--:--:--')
  const confettiRef = useRef<HTMLCanvasElement>(null)
  const floatersRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const monthlyPrizes = initialPrizes.filter((p) => p.cadence === 'monthly')
  const dailyPrizes = initialPrizes.filter((p) => p.cadence === 'daily')
  const displayMonthly = monthlyPrizes.length ? monthlyPrizes : DEMO_MONTHLY_PRIZES

  useEffect(() => {
    function tick() {
      const now = new Date()
      const end = new Date(now)
      end.setHours(24, 0, 0, 0)
      const diff = Math.max(0, end.getTime() - now.getTime())
      const h = String(Math.floor(diff / 3600000)).padStart(2, '0')
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0')
      setTimer(`${h}:${m}:${s}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const host = floatersRef.current
    if (!host) return
    const glyphs = ['🧦', '✨', '🧦', '⭐']
    const els: HTMLSpanElement[] = []
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('span')
      s.textContent = glyphs[i % glyphs.length]
      s.className = styles.floater
      s.style.left = 8 + Math.random() * 84 + '%'
      s.style.animationDuration = 7 + Math.random() * 6 + 's'
      s.style.animationDelay = Math.random() * 6 + 's'
      s.style.fontSize = 14 + Math.random() * 10 + 'px'
      host.appendChild(s)
      els.push(s)
    }
    return () => els.forEach((el) => el.remove())
  }, [])

  function launchConfetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = confettiRef.current
    if (!canvas) return
    const panel = canvas.closest('div')
    const rect = (panel ?? canvas).getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const colors = ['#6E4429', '#E7A33B', '#C1442D', '#F1E9D8', '#4C7A4A']
    const parts = Array.from({ length: 70 }, () => ({
      x: canvas.width / 2,
      y: 40,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -7 - 2,
      g: 0.28,
      size: Math.random() * 5 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      life: 90,
    }))
    let frame = 0
    function draw() {
      frame++
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
      let alive = false
      parts.forEach((p) => {
        if (p.life <= 0) return
        alive = true
        p.vy += p.g
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        p.life--
        ctx!.save()
        ctx!.translate(p.x, p.y)
        ctx!.rotate(p.rot)
        ctx!.fillStyle = p.color
        ctx!.globalAlpha = Math.min(1, p.life / 30)
        ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx!.restore()
      })
      if (alive && frame < 140) requestAnimationFrame(draw)
      else ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
    }
    draw()
  }

  // Saves whatever's known so far — called after phone+name, and again
  // after email — so a partial signup is captured even if the customer
  // never reaches the last step.
  async function saveStep(fields: { name?: string; email?: string }): Promise<SaveStepResult | null> {
    const res = await fetch('/api/gang/save-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.replace(/\D/g, ''), ...fields }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Try again.')
    return data
  }

  async function handlePhoneNameContinue() {
    const digits = phone.replace(/\D/g, '')
    const trimmedName = name.trim()
    const next: Record<string, string> = {}
    if (digits.length < 8) next.phone = 'Enter a valid phone number to continue.'
    if (!trimmedName) next.name = 'We need your name.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSaving(true)
    try {
      const data = await saveStep({ name: trimmedName })
      if (data?.member.email) {
        setReturning(true)
        setEmail(data.member.email)
        setReturningStats(data.stats)
        setStep(2)
      } else {
        setReturning(false)
        setReturningStats(null)
        setStep(1)
      }
    } catch (err) {
      setErrors({ phone: err instanceof Error ? err.message : 'Could not reach the server. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleEmailContinue() {
    const trimmedEmail = email.trim()
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
    if (!emailOk) {
      setErrors({ email: 'Enter a valid email.' })
      return
    }
    setErrors({})
    setSaving(true)
    try {
      await saveStep({ email: trimmedEmail })
      setStep(2)
    } catch (err) {
      setErrors({ email: err instanceof Error ? err.message : 'Could not reach the server. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  async function fetchTickets(): Promise<TicketListResult | null> {
    const res = await fetch('/api/gang/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.replace(/\D/g, '') }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) throw new Error(data?.error ?? 'Could not load your tickets. Try again.')
    return data
  }

  // "Already registered? View my tickets" on the phone step — lets a member
  // pull up all their current-month tickets (e.g. at claim time) without
  // registering another order.
  async function handleViewTickets() {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 8) {
      setErrors({ phone: 'Enter your phone number first, then tap View my tickets.' })
      return
    }
    setErrors({})
    setLoadingTickets(true)
    try {
      const data = await fetchTickets()
      setTicketList(data)
      setViewingTickets(true)
    } catch (err) {
      setErrors({ phone: err instanceof Error ? err.message : 'Could not load your tickets.' })
    } finally {
      setLoadingTickets(false)
    }
  }

  async function handleRegister() {
    const next: Record<string, string> = {}
    if (!platform) next.platform = 'Pick where you bought from.'
    if (!orderNumber.trim()) next.order = 'Enter your order number to continue.'
    setErrors(next)
    if (Object.keys(next).length) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/gang/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.replace(/\D/g, ''),
          platform,
          order_number: orderNumber.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrors({ order: data.error ?? 'Could not register your order. Try again.' })
        return
      }
      setResult(data)
      setStep(3)
      launchConfetti()
      // Load the full ticket list in the background so the success page can
      // show ALL of this month's tickets (5 orders = 5 tickets).
      fetchTickets().then(setTicketList).catch(() => {})
    } catch {
      setErrors({ order: 'Could not reach the server. Check your connection and try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  function resetAll() {
    setStep(0)
    setReturning(false)
    setPhone('')
    setName('')
    setEmail('')
    setPlatform(null)
    setOrderNumber('')
    setErrors({})
    setResult(null)
    setPerkCopied(null)
    setReturningStats(null)
    setTicketList(null)
    setViewingTickets(false)
  }

  // From the ticket list, jump straight into registering another order —
  // phone stays filled (and name seeded from their membership, since the
  // view-tickets path never asked for it) so they land on the order step.
  function registerFromTicketView() {
    setViewingTickets(false)
    setPlatform(null)
    setOrderNumber('')
    setErrors({})
    if (!name.trim() && ticketList?.member.name) setName(ticketList.member.name)
    setStep(2)
    setReturning(true)
  }

  async function copyPerkCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setPerkCopied(code)
      setTimeout(() => setPerkCopied(null), 2000)
    } catch {
      // Clipboard API unavailable — the code is still visible to copy by hand.
    }
  }

  function segClass(i: number) {
    if (returning && i === 1) return `${styles.seg} ${styles.segSkip}`
    return styles.seg
  }
  function segFillClass(i: number) {
    if (i < step) return `${styles.segFill} ${styles.segFillDone}`
    if (i === step) return `${styles.segFill} ${styles.segFillActive}`
    return styles.segFill
  }

  return (
    <div className={styles.page}>
      <div className={styles.noise} />
      <div className={styles.stage}>
        <div className={styles.brandbar}>
          <XocksLogo />
        </div>

        <div className={styles.urgency}>
          <div className={styles.urgencyDot} />
          <div className={styles.urgencyText}>
            Register <b>today</b> — bonus draw entry
          </div>
          <div className={styles.urgencyTimer}>{timer}</div>
        </div>

        <section className={styles.hero}>
          <div className={styles.floaters} ref={floatersRef} />
          <h1 className={styles.heroTitle}>
            Bought your socks? Get <em>rewarded</em>.
          </h1>
        </section>

        <div className={styles.progress} id="gang-progress">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={segClass(i)}>
              <span className={segFillClass(i)} />
            </div>
          ))}
        </div>

        <div className={styles.cardzone}>
          <div className={styles.panel}>
            {/* Ticket list — a member's current-month tickets. Old months
                expire from view automatically: the API only ever returns
                the current draw month. */}
            {viewingTickets && ticketList && (
              <div className={styles.step}>
                <div style={{ textAlign: 'center' }}>
                  <p className={`${styles.eyebrow} ${styles.center}`}>
                    {drawMonthLabel(ticketList.draw_month)} LUCKY DRAW
                  </p>
                  <h1 className={`${styles.stepTitle} ${styles.center}`}>
                    Your Tickets 🎟️
                  </h1>
                  <p className={`${styles.stepSub} ${styles.center}`}>
                    {ticketList.tickets.length
                      ? <><b>{ticketList.tickets.length} ticket{ticketList.tickets.length > 1 ? 's' : ''}</b> in this month&apos;s draw.</>
                      : <>No tickets yet — register an order to get your first.</>}
                  </p>

                  <div className={styles.miniTickets}>
                    {ticketList.tickets.map((t) => (
                      <div key={t.ticket_no} className={styles.miniTicket}>
                        <span className={styles.miniNo}>{fmtTicketNo(t.ticket_no)}</span>
                        <span className={styles.miniMeta}>
                          {t.platform} · order ···{t.order_number.slice(-4)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {ticketList.pending_count > 0 && (
                    <p className={styles.ticketExpiry}>
                      ⏳ {ticketList.pending_count} order{ticketList.pending_count > 1 ? 's' : ''} verifying — more tickets coming.
                    </p>
                  )}

                  {ticketList.member.lifetime_code && (
                    <div className={styles.perkcard} style={{ textAlign: 'left' }}>
                      <div className={styles.perkhead}>💛 Your lifetime code — 10% off every order</div>
                      <div className={styles.perkcoderow}>
                        <span className={styles.perkcode}>{ticketList.member.lifetime_code}</span>
                        <button className={styles.perkcopy} onClick={() => copyPerkCode(ticketList.member.lifetime_code!)}>
                          {perkCopied === ticketList.member.lifetime_code ? 'Copied ✓' : 'Copy code'}
                        </button>
                      </div>
                      <a className={styles.redeemLink} href={redeemUrl(ticketList.member.lifetime_code)} target="_blank" rel="noopener noreferrer">
                        REDEEM HERE →
                      </a>
                    </div>
                  )}
                  <p className={styles.ticketExpiry}>
                    Valid for {drawMonthLabel(ticketList.draw_month).toLowerCase()} only — resets monthly. Winners announced on WhatsApp; show this screen to claim.
                  </p>

                  <div className={styles.btnrow} style={{ marginTop: 16 }}>
                    <button className={styles.btnPrimary} onClick={registerFromTicketView}>
                      Register another order
                    </button>
                  </div>
                  <button className={styles.linkBtn} onClick={() => setViewingTickets(false)}>
                    ← Back
                  </button>
                </div>
              </div>
            )}

            {!viewingTickets && step === 0 && (
              <div className={styles.step}>
                <p className={styles.eyebrow}>Step 1 of 4</p>
                <h1 className={styles.stepTitle}>Let&apos;s get you in</h1>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Phone number</span>
                  <div className={styles.inputwrap}>
                    <span className={styles.prefix}>+60</span>
                    <input
                      className={`${styles.input} ${styles.inputWithPrefix}`}
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      autoFocus
                      placeholder="12-345 6789"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && nameRef.current?.focus()}
                    />
                  </div>
                  {errors.phone && <div className={styles.err}>{errors.phone}</div>}
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Full name</span>
                  <input
                    ref={nameRef}
                    className={styles.input}
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. Wayne Lim"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePhoneNameContinue()}
                  />
                  {errors.name && <div className={styles.err}>{errors.name}</div>}
                </label>
                <div className={styles.btnrow}>
                  <button className={styles.btnPrimary} onClick={handlePhoneNameContinue} disabled={saving}>
                    {saving ? 'Saving…' : 'Continue'}
                  </button>
                </div>
                <button className={styles.linkBtn} onClick={handleViewTickets} disabled={loadingTickets}>
                  {loadingTickets ? 'Loading your tickets…' : '🎟️ Already registered? View my tickets'}
                </button>
              </div>
            )}

            {step === 1 && (
              <div className={styles.step}>
                <p className={styles.eyebrow}>Step 2 of 4</p>
                <h1 className={styles.stepTitle}>Last thing 📧</h1>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Email</span>
                  <input
                    className={styles.input}
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleEmailContinue()}
                  />
                  {errors.email && <div className={styles.err}>{errors.email}</div>}
                </label>
                <div className={styles.btnrow}>
                  <button className={styles.btnGhost} onClick={() => setStep(0)}>
                    Back
                  </button>
                  <button className={styles.btnPrimary} onClick={handleEmailContinue} disabled={saving}>
                    {saving ? 'Saving…' : 'Continue'}
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className={styles.step}>
                <p className={styles.eyebrow}>{returning ? 'Step 2 of 3' : 'Step 3 of 4'}</p>
                <h1 className={styles.stepTitle}>Where&apos;d you grab your socks?</h1>
                {returning && (
                  <div className={styles.welcomeback}>
                    <div>
                      👋 Welcome back{name ? `, ${name.split(' ')[0]}` : ''}!
                    </div>
                    {!!returningStats?.totalPairs && (
                      <div className={styles.welcomebackStats}>
                        🧦 {returningStats.totalPairs} pair{returningStats.totalPairs === 1 ? '' : 's'} so far
                        {returningStats.topProducts[0] && (
                          <span className={styles.welcomebackFave}> · Fave: {returningStats.topProducts[0].name}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Platform</span>
                  <div className={styles.chiprow}>
                    {PLATFORMS.map((p) => (
                      <div
                        key={p.value}
                        className={`${styles.chip} ${platform === p.value ? styles.chipSelected : ''}`}
                        onClick={() => {
                          setPlatform(p.value)
                          setErrors((e) => ({ ...e, platform: '' }))
                        }}
                      >
                        <span className={styles.chipBadge} style={{ background: p.bg }}>
                          {p.icon}
                        </span>
                        {p.label}
                      </div>
                    ))}
                  </div>
                  {errors.platform && <div className={styles.err}>{errors.platform}</div>}
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Order number</span>
                  <input
                    className={styles.input}
                    style={{ fontFamily: 'var(--fontMono)' }}
                    type="text"
                    placeholder="e.g. SPX1029384756 or #XC10234"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                  />
                  <div className={styles.hint}>
                    Paid but stock hasn&apos;t arrived yet? That&apos;s fine — just enter the order number from your receipt.
                  </div>
                  {errors.order && <div className={styles.err}>{errors.order}</div>}
                </label>
                <div className={styles.btnrow}>
                  <button className={styles.btnGhost} onClick={() => setStep(returning ? 0 : 1)}>
                    Back
                  </button>
                  <button className={styles.btnPrimary} onClick={handleRegister} disabled={submitting}>
                    {submitting ? 'Joining…' : 'Join the Gang 🚀'}
                  </button>
                </div>
                <div className={styles.helplink}>
                  Order number missing or not on your receipt?{' '}
                  <a href="mailto:info@xocks.co">
                    Email us — info@xocks.co
                  </a>
                </div>
              </div>
            )}

            {step === 3 && result && (
              <div className={styles.step}>
                <canvas className={styles.confetti} ref={confettiRef} />
                <div style={{ textAlign: 'center' }}>
                  <div className={styles.badgewrap}>
                    <div className={styles.gangbadge}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/xocks-logo.png" alt="Xocks" className={styles.gangbadgeLogo} />
                    </div>
                  </div>
                  <p className={`${styles.eyebrow} ${styles.center}`}>You&apos;re in</p>
                  <h1 className={`${styles.stepTitle} ${styles.center}`}>Welcome to the Gang 🧦</h1>

                  <div className={styles.idcard}>
                    <div className={styles.idcardTop}>
                      <div>
                        <div className={styles.idcardLabel}>Xocks Gang · Member</div>
                        <div className={styles.idcardName}>{result.member.name}</div>
                        <div className={styles.idcardId}>{maskPhone(phone.replace(/\D/g, ''))}</div>
                      </div>
                      <div className={styles.idcardTier}>FOUNDING</div>
                    </div>
                    <div className={styles.idcardFoot}>
                      <div className={styles.idcardSince}>
                        Member since{' '}
                        {new Date(result.member.created_at ?? Date.now()).toLocaleDateString('en-GB', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                      <div className={styles.idcardX}>X</div>
                    </div>
                  </div>

                  {/* THE one thing this page is about: your lucky draw ticket */}
                  {result.submission.status === 'valid' && result.ticket && (
                    <div className={styles.luckyTicket}>
                      <div className={styles.luckyMonth}>
                        🎟️ {drawMonthLabel(result.ticket.draw_month)} LUCKY DRAW
                      </div>
                      {ticketList && ticketList.tickets.length > 1 ? (
                        <div className={styles.miniTickets}>
                          {[...ticketList.tickets].reverse().map((t) => (
                            <div key={t.ticket_no} className={styles.miniTicket}>
                              <span className={styles.miniNo}>{fmtTicketNo(t.ticket_no)}</span>
                              <span className={styles.miniMeta}>
                                {t.ticket_no === result.ticket!.ticket_no ? '✨ new' : t.platform}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.luckyNo}>
                          #{String(result.ticket.ticket_no).padStart(4, '0')}
                        </div>
                      )}
                      <p className={styles.luckyHint}>
                        Screenshot this. Winners announced <b>end of {drawMonthLabel(result.ticket.draw_month).toLowerCase()}</b> on WhatsApp — show it to claim.
                      </p>
                    </div>
                  )}

                  {/* Pending — and the safety net for a verified order whose
                      ticket didn't come back (e.g. mid-deploy): same card,
                      number on its way, nobody sees an empty slot. */}
                  {(result.submission.status === 'pending' ||
                    (result.submission.status === 'valid' && !result.ticket)) && (
                    <div className={styles.luckyTicket}>
                      <div className={styles.luckyMonth}>🎟️ YOUR LUCKY DRAW TICKET</div>
                      <div className={styles.luckyNo}>#····</div>
                      <p className={styles.luckyHint}>
                        {result.submission.status === 'valid'
                          ? <>Verified — your number lands on <b>WhatsApp</b> shortly.</>
                          : <>Verifying your order — your number lands on <b>WhatsApp by 6PM</b> tonight.</>}
                      </p>
                    </div>
                  )}

                  {result.submission.status === 'invalid' && (
                    <div className={`${styles.statusrow} ${STATUS_COPY.invalid.cls}`}>
                      <div className={styles.statusdot} />
                      <div className={styles.statustext}>
                        <b>{STATUS_COPY.invalid.title}</b>
                        <span>{STATUS_COPY.invalid.desc}</span>
                      </div>
                    </div>
                  )}

                  {/* First-timer welcome codes — issued once, on the first
                      verified order only. Returning members see tickets. */}
                  {result.first_timer?.freepair_code && (
                    <div className={styles.perkcard}>
                      <div className={styles.perkhead}>🎁 Free pair — welcome gift</div>
                      <div className={styles.perkdesc}>RM13.99 off any purchase — one-time use.</div>
                      <div className={styles.perkcoderow}>
                        <span className={styles.perkcode}>{result.first_timer.freepair_code}</span>
                        <button className={styles.perkcopy} onClick={() => copyPerkCode(result.first_timer!.freepair_code!)}>
                          {perkCopied === result.first_timer.freepair_code ? 'Copied ✓' : 'Copy code'}
                        </button>
                      </div>
                      <a className={styles.redeemLink} href={redeemUrl(result.first_timer.freepair_code)} target="_blank" rel="noopener noreferrer">
                        REDEEM HERE →
                      </a>
                    </div>
                  )}
                  {result.first_timer?.lifetime_code && (
                    <div className={styles.perkcard}>
                      <div className={styles.perkhead}>💛 Your lifetime code</div>
                      <div className={styles.perkdesc}>10% off every order. Forever. Yours alone.</div>
                      <div className={styles.perkcoderow}>
                        <span className={styles.perkcode}>{result.first_timer.lifetime_code}</span>
                        <button className={styles.perkcopy} onClick={() => copyPerkCode(result.first_timer!.lifetime_code!)}>
                          {perkCopied === result.first_timer.lifetime_code ? 'Copied ✓' : 'Copy code'}
                        </button>
                      </div>
                      <a className={styles.redeemLink} href={redeemUrl(result.first_timer.lifetime_code)} target="_blank" rel="noopener noreferrer">
                        REDEEM HERE →
                      </a>
                    </div>
                  )}
                  {!result.first_timer && result.member.lifetime_code && (
                    <div className={styles.perkcard}>
                      <div className={styles.perkhead}>💛 Your lifetime code</div>
                      <div className={styles.perkdesc}>10% off every order. Forever. Yours alone.</div>
                      <div className={styles.perkcoderow}>
                        <span className={styles.perkcode}>{result.member.lifetime_code}</span>
                        <button className={styles.perkcopy} onClick={() => copyPerkCode(result.member.lifetime_code!)}>
                          {perkCopied === result.member.lifetime_code ? 'Copied ✓' : 'Copy code'}
                        </button>
                      </div>
                      <a className={styles.redeemLink} href={redeemUrl(result.member.lifetime_code)} target="_blank" rel="noopener noreferrer">
                        REDEEM HERE →
                      </a>
                    </div>
                  )}
                  {result.submission.status !== 'valid' && (
                    <div className={styles.perkpending}>
                      🧦 Welcome codes unlock once your order&apos;s verified.
                    </div>
                  )}

                  <div className={styles.btnrow} style={{ marginTop: 18 }}>
                    <button className={styles.btnPrimary} onClick={resetAll}>
                      Register another order
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Prize preview sells the signup — first screen only. After that
            the customer is already in the flow; keep every screen clean. */}
        {step === 0 && !viewingTickets && (
          <section className={styles.perksSection}>
            <div className={styles.prizepreview}>
              <div className={styles.ppHead}>🎉 This month&apos;s grand draw</div>
              {displayMonthly.map((p, i) => (
                <div key={p.id} className={`${styles.ppRow} ${i === 0 ? styles.ppRowTop : ''}`}>
                  <span className={styles.tier}>{p.tier_label}</span>
                  <span className={styles.ppOdds}>{p.probability_text ?? '—'}</span>
                </div>
              ))}
              <div className={styles.ppMore}>
                {dailyPrizes[0]?.prize_label
                  ? `✅ instant ${dailyPrizes[0].prize_label} on every verified order`
                  : '🎟️ every verified order = 1 draw ticket'}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
