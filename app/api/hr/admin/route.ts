import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { loadHrSettings } from '@/lib/hr/settings'
import { monthRange, parseYearMonth } from '@/lib/monthly-report/months'
import {
  CLAIM_COLUMNS, LEAVE_COLUMNS, MEMBER_COLUMNS, PENALTY_COLUMNS, numClaim, numLeave, numMember,
} from '@/lib/hr/types'
import { todayMYT } from '@/lib/sales/last-sale'

/**
 * GET /api/hr/admin?month=YYYY-MM — everything the HR admin page shows:
 * every pending request (any month), the month's claims / leave / penalties,
 * all staff with entitlements, holidays from this year on, and settings.
 */
export async function GET(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const ym = request.nextUrl.searchParams.get('month') ?? todayMYT().slice(0, 7)
  if (!parseYearMonth(ym)) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  const { start, end } = monthRange(ym)

  const supabase = await createClient()
  const [members, pendingClaims, pendingLeaves, claims, leaves, penalties, holidays, settings] = await Promise.all([
    supabase.from('xocks_team_members').select(`${MEMBER_COLUMNS}, hr_pin_hash`).order('name'),
    supabase.from('hr_claims').select(CLAIM_COLUMNS).eq('status', 'pending').order('created_at'),
    supabase.from('hr_leaves').select(LEAVE_COLUMNS).eq('status', 'pending').order('created_at'),
    supabase.from('hr_claims').select(CLAIM_COLUMNS).gte('claim_date', start).lte('claim_date', end).order('claim_date', { ascending: false }),
    supabase.from('hr_leaves').select(LEAVE_COLUMNS).lte('start_date', end).gte('end_date', start).order('start_date', { ascending: false }),
    supabase.from('hr_penalties').select(PENALTY_COLUMNS).gte('penalty_date', start).lte('penalty_date', end).order('penalty_date', { ascending: false }),
    supabase.from('hr_public_holidays').select('id, holiday_date, name').gte('holiday_date', `${todayMYT().slice(0, 4)}-01-01`).order('holiday_date'),
    loadHrSettings(supabase),
  ])
  const firstError = [members, pendingClaims, pendingLeaves, claims, leaves, penalties, holidays].find((r) => r.error)?.error
  if (firstError) return Response.json({ error: firstError.message }, { status: 500 })

  return Response.json({
    month: ym,
    // Only whether a PIN is set ever leaves the server, never the hash.
    members: (members.data ?? []).map(({ hr_pin_hash, ...m }) => ({ ...numMember(m), has_pin: !!hr_pin_hash })),
    pending_claims: (pendingClaims.data ?? []).map(numClaim),
    pending_leaves: (pendingLeaves.data ?? []).map(numLeave),
    claims: (claims.data ?? []).map(numClaim),
    leaves: (leaves.data ?? []).map(numLeave),
    penalties: (penalties.data ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
    holidays: holidays.data ?? [],
    settings,
  })
}
