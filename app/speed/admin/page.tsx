import type { Metadata } from 'next'
import styles from '../speed.module.css'
import { SpeedAdmin } from './SpeedAdmin'

// Game-master console for the Beat The Speed challenge. Public route,
// gated by the shared access code inside the page (checked server-side
// on every action) — no XCMS account needed.
export const metadata: Metadata = {
  title: 'Beat The Speed — Game Master',
  description: 'Key in treadmill challenge results.',
  robots: { index: false, follow: false },
}

export default function SpeedAdminPage() {
  return (
    <div className={styles.page}>
      <div className={styles.wrap} style={{ paddingTop: 24 }}>
        <SpeedAdmin />
      </div>
    </div>
  )
}
