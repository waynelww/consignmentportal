export const dynamic = 'force-dynamic'

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
