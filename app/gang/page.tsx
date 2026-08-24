// Prizes rarely change (only when the team edits them via /prizes or
// /gangperk), so this page is cached and revalidated in the background
// every 60s rather than hitting Supabase on every single visit — that
// round-trip was the main cause of slow first-paint on a cold QR scan.
// The actual registration flow (check-phone/register) is unaffected: those
// happen via client-side fetches to always-live API routes, not this page.
export const revalidate = 60

import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActivePrizes } from '@/lib/gang/prizes'
import { GangRegister } from './GangRegister'

export const metadata: Metadata = {
  title: 'Xocks Gang — Member Registration',
  description: 'Register your order to join Xocks Gang and unlock perks + our monthly grand draw.',
}

// Public, unauthenticated page — the QR code on every thank-you card points
// here. Prizes are fetched server-side so the perks/prize list is visible
// on first paint, before any client JS runs.
export default async function GangPage() {
  const supabase = createAdminClient()
  const prizes = await getActivePrizes(supabase).catch(() => [])

  return <GangRegister initialPrizes={prizes} />
}
