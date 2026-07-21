'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './gang.module.css'
import type { GangPrize } from '@/lib/gang/prizes'

type Platform = 'shopee' | 'tiktok' | 'website' | 'instagram' | 'instore'
type SubmissionStatus = 'pending' | 'valid' | 'invalid'

interface RegisterResult {
  member: { id: string; name: string; email: string; created_at?: string }
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
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="5" stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.4" stroke="#fff" strokeWidth="1.6" />
      <circle cx="16.6" cy="7.4" r="1" fill="#fff" />
    </svg>
  )
}
function InstoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 9l1-4h14l1 4" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" stroke="#fff" strokeWidth="1.5" />
      <path d="M5 9v10h14V9" stroke="#fff" strokeWidth="1.6" />
    </svg>
  )
}

const PLATFORMS: { value: Platform; label: string; bg: string; icon: ReactNode }[] = [
  { value: 'shopee', label: 'Shopee', bg: '#EE4D2D', icon: <ShopeeIcon /> },
  { value: 'tiktok', label: 'TikTok Shop', bg: '#000', icon: <TikTokIcon /> },
  { value: 'website', label: 'Website', bg: 'var(--brown)', icon: <WebsiteIcon /> },
  { value: 'instagram', label: 'Instagram', bg: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)', icon: <InstagramIcon /> },
  { value: 'instore', label: 'In-store', bg: 'var(--brownDeep)', icon: <InstoreIcon /> },
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
  const [checkingPhone, setCheckingPhone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [orderNumber, setOrderNumber] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<RegisterResult | null>(null)
  const [perkCopied, setPerkCopied] = useState(false)

  const [timer, setTimer] = useState('--:--:--')
  const confettiRef = useRef<HTMLCanvasElement>(null)
  const floatersRef = useRef<HTMLDivElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  const monthlyPrizes = initialPrizes.filter((p) => p.cadence === 'monthly')
  const dailyPrizes = initialPrizes.filter((p) => p.cadence === 'daily')
  const displayMonthly = monthlyPrizes.length ? monthlyPrizes : DEMO_MONTHLY_PRIZES
  const topPrize = displayMonthly[0]
  const moreCount = displayMonthly.length - 1

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

  async function handlePhoneContinue() {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 8) {
      setErrors({ phone: 'Enter a valid phone number to continue.' })
      return
    }
    setErrors({})
    setCheckingPhone(true)
    try {
      const res = await fetch('/api/gang/check-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrors({ phone: data.error ?? 'Something went wrong. Try again.' })
        return
      }
      if (data.exists) {
        setReturning(true)
        setName(data.name ?? '')
        setStep(2)
      } else {
        setReturning(false)
        setStep(1)
      }
    } catch {
      setErrors({ phone: 'Could not reach the server. Check your connection and try again.' })
    } finally {
      setCheckingPhone(false)
    }
  }

  function handleNameEmailContinue() {
    const trimmedName = name.trim()
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    const next: Record<string, string> = {}
    if (!trimmedName) next.name = 'We need your name.'
    if (!emailOk) next.email = 'Enter a valid email.'
    setErrors(next)
    if (Object.keys(next).length) return
    setStep(2)
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
          name: returning ? undefined : name.trim(),
          email: returning ? undefined : email.trim(),
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
          <div className={styles.brandmark}>X</div>
          <div className={styles.brandname}>Xocks Gang</div>
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
            You already bought the socks — now come get <em>rewarded</em> for it.
          </h1>

          <div className={styles.perks}>
            <div className={styles.perk}>
              <span className={styles.perkIco}>💬</span> Exclusive promo codes sent straight to your WhatsApp
            </div>
            <div className={styles.perk}>
              <span className={styles.perkIco}>🎟️</span> Entry into our monthly Grand Draw, every order counts
            </div>
            <div className={styles.perk}>
              <span className={styles.perkIco}>🚀</span> Early access to new drops before anyone else
            </div>
          </div>

          <div className={styles.prizepreview}>
            <div className={styles.ppHead}>🎉 This month&apos;s grand draw</div>
            <div className={`${styles.ppRow} ${styles.ppRowTop}`}>
              <span className={styles.tier}>{topPrize.tier_label}</span>
              <span className={styles.ppOdds}>{topPrize.probability_text ?? '—'}</span>
            </div>
            <div className={styles.ppMore}>
              {moreCount > 0 && `+ ${moreCount} more prize${moreCount > 1 ? 's' : ''} · `}
              {dailyPrizes[0]?.prize_label
                ? `✅ instant ${dailyPrizes[0].prize_label} on every verified order`
                : '✅ instant 10–20% promo code on every verified order'}
            </div>
          </div>
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
                <h1 className={styles.stepTitle}>What&apos;s your WhatsApp number?</h1>
                <p className={styles.stepSub}>
                  This is your Gang member ID — one account per number, and how we&apos;ll send your promos and draw results.
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
                      onKeyDown={(e) => e.key === 'Enter' && handlePhoneContinue()}
                    />
                  </div>
                  <div className={styles.hint}>We&apos;ll only use this for order updates &amp; promo codes on WhatsApp.</div>
                  {errors.phone && <div className={styles.err}>{errors.phone}</div>}
                </label>
                <div className={styles.btnrow}>
                  <button className={styles.btnPrimary} onClick={handlePhoneContinue} disabled={checkingPhone}>
                    {checkingPhone ? 'Checking…' : 'Continue'}
                  </button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className={styles.step}>
                <p className={styles.eyebrow}>Step 2 of 4</p>
                <h1 className={styles.stepTitle}>Nice to meet you 👋</h1>
                <p className={styles.stepSub}>Tell us who&apos;s joining the gang.</p>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Full name</span>
                  <input
                    className={styles.input}
                    type="text"
                    autoComplete="name"
                    autoFocus
                    placeholder="e.g. Wayne Lim"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && emailRef.current?.focus()}
                  />
                  {errors.name && <div className={styles.err}>{errors.name}</div>}
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Email</span>
                  <input
                    ref={emailRef}
                    className={styles.input}
                    type="email"
                    autoComplete="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleNameEmailContinue()}
                  />
                  {errors.email && <div className={styles.err}>{errors.email}</div>}
                </label>
                <div className={styles.btnrow}>
                  <button className={styles.btnGhost} onClick={() => setStep(0)}>
                    Back
                  </button>
                  <button className={styles.btnPrimary} onClick={handleNameEmailContinue}>
                    Continue
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
                    👋 Welcome back{name ? `, ${name.split(' ')[0]}` : ''} — recognized your number, no need to
                    re-enter your details.
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
      </div>

      <a className={styles.fab} href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp">
        <svg viewBox="0 0 32 32" fill="#fff" width={28} height={28}>
          <path d="M16.02 3C9.4 3 4.02 8.38 4.02 15c0 2.22.6 4.3 1.65 6.1L4 29l8.1-1.63A11.9 11.9 0 0 0 16.02 27C22.64 27 28 21.62 28 15S22.64 3 16.02 3zm0 21.6a9.55 9.55 0 0 1-4.87-1.33l-.35-.2-4.8.97.98-4.67-.23-.36A9.56 9.56 0 1 1 16.02 24.6zm5.5-7.15c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15s-.77.97-.94 1.17-.35.22-.65.07a8.02 8.02 0 0 1-2.36-1.46 8.85 8.85 0 0 1-1.63-2.02c-.17-.3 0-.46.13-.6.14-.14.3-.35.45-.53.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.68-1.63-.93-2.24-.24-.58-.5-.5-.68-.51h-.58a1.12 1.12 0 0 0-.8.37 3.4 3.4 0 0 0-1.06 2.53c0 1.5 1.09 2.94 1.24 3.14.15.2 2.15 3.28 5.2 4.6.73.31 1.3.5 1.74.64.73.23 1.4.2 1.92.12.59-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35z" />
        </svg>
      </a>
    </div>
  )
}
