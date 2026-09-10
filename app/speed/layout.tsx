import { Anton, Barlow, Barlow_Condensed } from 'next/font/google'

// Beat The Speed uses the campaign-poster type (Anton + Barlow), not the
// XCMS admin fonts — loaded here once for both /speed and /speed/admin.
const anton = Anton({ weight: '400', subsets: ['latin'], variable: '--font-anton' })
const barlow = Barlow({ weight: ['500', '600', '700', '800'], subsets: ['latin'], variable: '--font-barlow' })
const barlowCondensed = Barlow_Condensed({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-barlow-cond',
})

export default function SpeedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${anton.variable} ${barlow.variable} ${barlowCondensed.variable}`}>
      {children}
    </div>
  )
}
