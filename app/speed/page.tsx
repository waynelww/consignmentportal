import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { SpeedBoard, type BoardEntry } from './SpeedBoard'

// Public display board for the Beat The Speed treadmill challenge —
// opened on the gym TV / any phone, no login. First paint is served with
// the entries already in it; the client then polls for live updates.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Beat The Speed — Live Leaderboard',
  description: 'Xocks × Desire Gym treadmill challenge — live top 5 men and women.',
}

export default async function SpeedPage() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('speed_entries')
    .select('id, name, gender, speed, phone')
    .order('speed', { ascending: false })
    .order('id', { ascending: true })

  const entries: BoardEntry[] = (data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    gender: e.gender,
    speed: Number(e.speed),
    phone_last4: e.phone ? e.phone.replace(/\D/g, '').slice(-4) : '',
  }))

  return <SpeedBoard initialEntries={entries} />
}
