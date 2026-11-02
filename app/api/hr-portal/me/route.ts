import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { portalMember } from '@/lib/hr/portal-session'
import { completedYears, entitlementsFor, leaveBalance, replacementBalance } from '@/lib/hr/rules'
import { loadHolidaySet, loadHrSettings } from '@/lib/hr/settings'
import {
  CLAIM_COLUMNS, LEAVE_COLUMNS, MEMBER_COLUMNS, PENALTY_COLUMNS, WORK_COLUMNS, numClaim, numLeave, numMember, numWork,
  type HrLeave, type HrMember, type HrRestDayWork,
} from '@/lib/hr/types'
import { todayMYT } from '@/lib/sales/last-sale'

/**
 * GET /api/hr-portal/me — the signed-in person's page: this year's and last
 * year's claims, leave/MC, rest-day work and penalties, plus balances
 * (annual and MC from the join date per the Employment Act unless set by
 * hand; replacement from approved rest-day work), holidays and the work-day
 * setting (for counting leave days before submitting).
 */
export async function GET(request: NextRequest) {
  const db = await createServiceClient()
  const me = await portalMember(request, db)
  if (!me) return Response.json({ error: 'Signed out' }, { status: 401 })

  const today = todayMYT()
  const year = Number(today.slice(0, 4))
  const since = `${year - 1}-01-01`
  const [memberRes, claimsRes, leavesRes, penaltiesRes, holidaysRes, settings, holidays, workRes, replacementLeavesRes] = await Promise.all([
    db.from('xocks_team_members').select(MEMBER_COLUMNS).eq('id', me.id).single(),
    db.from('hr_claims').select(CLAIM_COLUMNS).eq('member_id', me.id).gte('claim_date', since).order('claim_date', { ascending: false }),
    db.from('hr_leaves').select(LEAVE_COLUMNS).eq('member_id', me.id).gte('end_date', since).order('start_date', { ascending: false }),
    db.from('hr_penalties').select(PENALTY_COLUMNS).eq('member_id', me.id).gte('penalty_date', since).order('penalty_date', { ascending: false }),
    db.from('hr_public_holidays').select('id, holiday_date, name').gte('holiday_date', `${year}-01-01`).order('holiday_date'),
    loadHrSettings(db),
    loadHolidaySet(db, `${year}-01-01`, `${year}-12-31`),
    // Replacement balance is all-time, so these two are not limited to `since`.
    db.from('hr_rest_day_work').select(WORK_COLUMNS).eq('member_id', me.id).order('work_date', { ascending: false }),
    db.from('hr_leaves').select('leave_type, status, days').eq('member_id', me.id).eq('leave_type', 'replacement'),
  ])
  const firstError = [memberRes, claimsRes, leavesRes, penaltiesRes, holidaysRes, workRes, replacementLeavesRes].find((r) => r.error)?.error
  if (firstError) return Response.json({ error: firstError.message }, { status: 500 })

  const member = numMember(memberRes.data!) as HrMember
  const leaves = (leavesRes.data ?? []).map(numLeave) as HrLeave[]
  const opts = { workDays: settings.workDays, holidays }
  const ent = entitlementsFor(member, year)
  const work = (workRes.data ?? []).map(numWork) as HrRestDayWork[]
  return Response.json({
    member,
    year,
    entitlement: {
      source: ent.source,
      years_of_service: member.join_date ? completedYears(member.join_date, today) : null,
    },
    balances: {
      annual: leaveBalance('annual', ent.annual, leaves, year, opts),
      mc: leaveBalance('mc', ent.mc, leaves, year, opts),
      replacement: replacementBalance(work, (replacementLeavesRes.data ?? []).map(numLeave)),
    },
    work,
    claims: (claimsRes.data ?? []).map(numClaim),
    leaves,
    penalties: (penaltiesRes.data ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
    holidays: holidaysRes.data ?? [],
    work_days: settings.workDays,
  })
}
