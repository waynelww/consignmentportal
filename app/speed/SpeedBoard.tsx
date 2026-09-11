'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './speed.module.css'

export interface BoardEntry {
  id: number
  name: string
  gender: 'M' | 'F'
  speed: number
  phone_last4: string
}

const TOP_N = 5

function topFive(entries: BoardEntry[], gender: 'M' | 'F') {
  return entries
    .filter((e) => e.gender === gender)
    .sort((a, b) => b.speed - a.speed || a.id - b.id)
    .slice(0, TOP_N)
}

function Board({ gender, entries }: { gender: 'M' | 'F'; entries: BoardEntry[] }) {
  const list = topFive(entries, gender)
  const rows = []
  for (let i = 0; i < TOP_N; i++) {
    const e = list[i]
    if (e) {
      rows.push(
        <div key={e.id} className={`${styles.row} ${i === 0 ? styles.rowFirst : ''}`}>
          <div className={styles.rank}>{i === 0 ? '👑' : i + 1}</div>
          <div className={styles.name}>
            {e.name}
            {e.phone_last4 && <span className={styles.ph}>····{e.phone_last4}</span>}
          </div>
          <div className={styles.speed}>
            {e.speed.toFixed(1)}
            <small>KM/H</small>
          </div>
        </div>,
      )
    } else {
      rows.push(
        <div key={`empty-${i}`} className={`${styles.row} ${styles.rowEmpty}`}>
          <div className={styles.rank}>{i + 1}</div>
          <div className={styles.name}>WAITING FOR RUNNER</div>
          <div className={styles.speed}>
            —<small>KM/H</small>
          </div>
        </div>,
      )
    }
  }
  return (
    <section
      className={`${styles.board} ${gender === 'M' ? styles.boardMen : styles.boardWomen}`}
      aria-label={`${gender === 'M' ? 'Men' : 'Women'} leaderboard`}
    >
      <div className={styles.boardHead}>
        <div className={styles.boardTitle}>
          {gender === 'M' ? '🏃' : '🏃‍♀️'} <span>{gender === 'M' ? 'MEN' : 'WOMEN'}</span>
        </div>
      </div>
      <div className={styles.rows}>{rows}</div>
    </section>
  )
}

// The full campaign page: header, both boards, bottom logo, TV mode.
// Polls /api/speed/entries so every open screen stays in sync — the
// gym TV, the game master's phone, anyone watching the link.
export function SpeedBoard({ initialEntries }: { initialEntries: BoardEntry[] }) {
  const [entries, setEntries] = useState<BoardEntry[]>(initialEntries)
  const [tv, setTv] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/speed/entries', { cache: 'no-store' })
        const data = await res.json()
        if (alive && data.entries) setEntries(data.entries)
      } catch {
        /* offline blip — keep showing the last known board */
      }
    }
    const interval = setInterval(tick, 5000)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [])

  // TV mode scales the whole layout so header + both boards + logo fill
  // the screen exactly, like the standalone event file.
  const fitTV = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    if (!tv) {
      wrap.style.transform = ''
      return
    }
    wrap.style.transform = ''
    const w = wrap.offsetWidth
    const h = wrap.scrollHeight
    const s = Math.min(window.innerWidth / w, window.innerHeight / h)
    // Origin is top-left (the fixed-width wrap overflows small screens),
    // so center the scaled layout ourselves.
    const tx = Math.max(0, (window.innerWidth - w * s) / 2)
    const ty = Math.max(0, (window.innerHeight - h * s) / 2)
    wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
  }, [tv])

  useEffect(() => {
    requestAnimationFrame(fitTV)
    if (!tv) return
    const onResize = () => requestAnimationFrame(fitTV)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') exitTV()
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('fullscreenchange', onResize)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('fullscreenchange', onResize)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv, fitTV])

  const enterTV = () => {
    setTv(true)
    const el = document.documentElement
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
  }
  const exitTV = () => {
    setTv(false)
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {})
    }
  }

  return (
    <div ref={pageRef} className={`${styles.page} ${tv ? styles.tv : ''}`}>
      <div ref={wrapRef} className={styles.wrap}>
        <header className={styles.header}>
          <div>
            <div className={styles.slogan}>
              <span>
                XOCKS <b className={styles.forAll}>FOR ALL</b>
              </span>
            </div>
          </div>
          <div className={styles.banner}>
            <div className={styles.bannerInner}>
              <div className={styles.kicker}>
                CAN YOU <span className={styles.kickerLift}>BEAT THE</span>
              </div>
              <h1 className={styles.h1}>
                SPEED<span className={styles.qMark}>?</span>
              </h1>
              <div className={styles.streak} />
            </div>
          </div>
          <div className={styles.subline}>
            <span className={styles.liveDot} />
            LIVE LEADERBOARD · XOCKS <span className={styles.subX}>×</span> DESIRE GYM
          </div>
        </header>

        <div className={styles.boards}>
          <Board gender="M" entries={entries} />
          <Board gender="F" entries={entries} />
        </div>

        <div className={styles.bottomBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/xocks-logo.png" alt="XOCKS" />
        </div>

        <footer className={styles.footer}>Powered by Desire Gym · Boom+ Run</footer>
      </div>

      <button className={styles.tvBtn} type="button" onClick={enterTV}>
        📺 Fit to TV
      </button>
      <button className={styles.tvExit} type="button" onClick={exitTV} aria-label="Exit TV mode">
        ✕
      </button>
    </div>
  )
}
