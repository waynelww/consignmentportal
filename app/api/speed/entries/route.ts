import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/speed/entries
// Public — feeds the /speed display board, which polls this every few
// seconds. Phone numbers never leave the server in full here: the board
// only ever shows the last 4 digits, so that's all we return.
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('speed_entries')
    .select('id, name, gender, speed, phone')
    .order('speed', { ascending: false })
    .order('id', { ascending: true })

  if (error) {
    return Response.json({ error: 'Could not load the leaderboard.' }, { status: 500 })
  }

  const entries = (data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    gender: e.gender,
    speed: Number(e.speed),
    phone_last4: e.phone ? e.phone.replace(/\D/g, '').slice(-4) : '',
  }))

  return Response.json({ entries })
}
