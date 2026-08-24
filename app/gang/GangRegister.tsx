'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './gang.module.css'
import type { GangPrize } from '@/lib/gang/prizes'

type Platform = 'shopee' | 'tiktok' | 'website'
type SubmissionStatus = 'pending' | 'valid' | 'invalid'

interface RegisterResult {
  member: { id: string; name: string; email: string | null; created_at?: string }
  submission: {
    id: string
    order_number: string
    platform: Platform
    status: SubmissionStatus
    submitted_date: string
    verified_at: string | null
  }
  prizes: GangPrize[]
  perk: { code: string; min_quantity: number; discount_amount: number } | null
  stats: MemberStats | null
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

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_GANG_WHATSAPP_NUMBER || '60000000000'

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
    desc: "We couldn't match this order yet. Tap the WhatsApp button below and our team will sort it out.",
    cls: styles.statusInvalid,
  },
}

function maskPhone(phone: string) {
  return '•••• ' + phone.slice(-4)
}

const DEMO_MONTHLY_PRIZES: GangPrize[] = [
  { id: 'demo-1', tier_label: '🏆 Free Socks for a Year', probability_text: '1 / 10,000', cadence: 'monthly', prize_label: '' },
  { id: 'demo-2', tier_label: '🎁 Mystery "Hidden" Gift', probability_text: 'rolling', cadence: 'monthly', prize_label: '' },
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
  const [perkCopied, setPerkCopied] = useState(false)
  const [returningStats, setReturningStats] = useState<MemberStats | null>(null)

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
    setPerkCopied(false)
    setReturningStats(null)
  }

  async function copyPerkCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setPerkCopied(true)
      setTimeout(() => setPerkCopied(false), 2000)
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
          <span className={styles.brandGang}>GANG</span>
        </div>

        <div className={styles.urgency}>
          <div className={styles.urgencyDot} />
          <div className={styles.urgencyText}>
            Register <b>today</b> for a bonus entry into this month&apos;s Grand Draw
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
            {step === 0 && (
              <div className={styles.step}>
                <p className={styles.eyebrow}>Step 1 of 4</p>
                <h1 className={styles.stepTitle}>Let&apos;s get you in</h1>
                <p className={styles.stepSub}>
                  Your WhatsApp number is your Gang member ID — one account per number.
                </p>
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
                  <div className={styles.hint}>We&apos;ll only use this for order updates &amp; promo codes on WhatsApp.</div>
                  {errors.name && <div className={styles.err}>{errors.name}</div>}
                </label>
                <div className={styles.btnrow}>
                  <button className={styles.btnPrimary} onClick={handlePhoneNameContinue} disabled={saving}>
                    {saving ? 'Saving…' : 'Continue'}
                  </button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className={styles.step}>
                <p className={styles.eyebrow}>Step 2 of 4</p>
                <h1 className={styles.stepTitle}>Last thing 📧</h1>
                <p className={styles.stepSub}>Where should your welcome perks land?</p>
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
                <p className={styles.stepSub}>
                  Pick the platform, then pop in your order number — our team confirms all orders daily at 6PM.
                </p>
                {returning && (
                  <div className={styles.welcomeback}>
                    <div>
                      👋 Welcome back{name ? `, ${name.split(' ')[0]}` : ''} — recognized your number, no need to
                      re-enter your details.
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
                  <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
                    Chat us on WhatsApp
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
                      <svg viewBox="0 0 24 24" fill="none" width={52} height={52}>
                        <path d="M4 4L20 20M20 4L4 20" stroke="#F1E9D8" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>
                  <p className={`${styles.eyebrow} ${styles.center}`}>You&apos;re in</p>
                  <h1 className={`${styles.stepTitle} ${styles.center}`}>Welcome to the Gang 🧦</h1>
                  <p className={`${styles.stepSub} ${styles.center}`}>
                    Your member card is live — perks &amp; promo codes land on WhatsApp.
                  </p>

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

                  {!!result.stats?.totalPairs && (
                    <div className={styles.statsstrip}>
                      <div className={styles.statsstripTotal}>
                        <span className={styles.statsstripNum}>{result.stats.totalPairs}</span> pair
                        {result.stats.totalPairs === 1 ? '' : 's'} bought total
                      </div>
                      {result.stats.topProducts.length > 0 && (
                        <div className={styles.statsstripTop}>
                          {result.stats.topProducts.map((p, i) => (
                            <span key={i} className={styles.statsstripChip}>
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`${styles.statusrow} ${STATUS_COPY[result.submission.status].cls}`}>
                    <div className={styles.statusdot} />
                    <div className={styles.statustext}>
                      <b>{STATUS_COPY[result.submission.status].title}</b>
                      <span>{STATUS_COPY[result.submission.status].desc}</span>
                    </div>
                  </div>

                  {result.submission.status === 'valid' && result.perk && (
                    <div className={styles.perkcard}>
                      <div className={styles.perkhead}>🧦 Your standing checkout perk</div>
                      <div className={styles.perkdesc}>
                        Get RM{result.perk.discount_amount.toFixed(2)} off any order once you've got{' '}
                        {result.perk.min_quantity}+ pairs in your cart — use it every time you shop.
                      </div>
                      <div className={styles.perkcoderow}>
                        <span className={styles.perkcode}>{result.perk.code}</span>
                        <button className={styles.perkcopy} onClick={() => copyPerkCode(result.perk!.code)}>
                          {perkCopied ? 'Copied ✓' : 'Copy code'}
                        </button>
                      </div>
                    </div>
                  )}
                  {result.submission.status === 'valid' && !result.perk && (
                    <div className={styles.perkpending}>
                      🧦 Your standing checkout perk is being set up — check back shortly.
                    </div>
                  )}
                  {result.submission.status !== 'valid' && (
                    <div className={styles.perkpending}>
                      🧦 Once your order's verified, you'll unlock a personal checkout discount code too.
                    </div>
                  )}

                  <div className={styles.ticket}>
                    <div className={styles.ticketHead}>🎟️ Your Grand Draw Entry This Month</div>
                    <div className={styles.prizepool}>
                      {result.prizes.length
                        ? result.prizes.map((p, i) => (
                            <div key={p.id} className={`${styles.pr} ${i === 0 ? styles.prTop : ''}`}>
                              <span className={styles.tier}>{p.tier_label}</span>
                              <span className={styles.ppOdds}>{p.probability_text ?? '—'}</span>
                            </div>
                          ))
                        : (
                          <div className={styles.pr}>
                            <span className={styles.tier}>Prizes will show here once configured</span>
                          </div>
                        )}
                    </div>
                  </div>

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

        <section className={styles.perksSection}>
          <div className={styles.perkWidgets}>
            <div className={styles.perkWidget}>
              <span className={styles.perkWidgetIco}>💬</span>
              <span>Exclusive promo codes on WhatsApp</span>
            </div>
            <div className={styles.perkWidget}>
              <span className={styles.perkWidgetIco}>🎟️</span>
              <span>Monthly Grand Draw entry</span>
            </div>
          </div>

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
                : '✅ instant 10–20% promo code on every verified order'}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
