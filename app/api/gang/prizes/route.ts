import { createAdminClient } from '@/lib/supabase/admin'
import { getActivePrizes } from '@/lib/gang/prizes'

// GET /api/gang/prizes
// Public. Powers the registration page's up-front perks/prize display —
// shown before any input is collected.
export async function GET() {
  const supabase = createAdminClient()
  try {
    const prizes = await getActivePrizes(supabase)
    return Response.json({ prizes })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to load prizes' }, { status: 500 })
  }
}
