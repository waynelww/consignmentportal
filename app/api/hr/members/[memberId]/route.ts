import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { logHr } from '@/lib/hr/audit'
import { MEMBER_COLUMNS, numMember } from '@/lib/hr/types'
import { isValidJoinDate, statutoryEntitlements } from '@/lib/hr/rules'
import { todayMYT } from '@/lib/sales/last-sale'

const Days = z.number().min(0).max(60).refine((n) => Number.isInteger(n * 2), 'Use whole or half days')

/**
 * PATCH /api/hr/members/[memberId]
 *   { join_date? }                   — statutory leave is worked out from it
 *   { custom_entitlement?, annual_leave_days?, mc_days? }
 *                                    — custom on: use the typed numbers
 *                                      instead of the Employment Act minimums
 *   { reset_pin: true }              — clears the PIN; the person sets a new
 *                                      one on their next visit, and every
 *                                      device signed in as them is signed out
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const { memberId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = z.object({
    annual_leave_days: Days.optional(),
    mc_days: Days.optional(),
    reset_pin: z.literal(true).optional(),
    join_date: z.string().refine((d) => isValidJoinDate(d, todayMYT()), 'Enter a real join date, not in the future').optional(),
    custom_entitlement: z.boolean().optional(),
  }).safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  const { reset_pin, join_date, custom_entitlement, ...days } = parsed.data
  if (!reset_pin && join_date === undefined && custom_entitlement === undefined && Object.keys(days).length === 0) return Response.json({ error: 'Nothing to update' }, { status: 400 })

  const svc = await createServiceClient()
  const { data: before } = await svc.from('xocks_team_members').select(MEMBER_COLUMNS).eq('id', memberId).maybeSingle()
  if (!before) return Response.json({ error: 'Not found' }, { status: 404 })

  // Custom numbers can go above the Employment Act minimum, never below it.
  const customOn = custom_entitlement ?? before.custom_entitlement
  const effectiveJoin = join_date ?? before.join_date
  if (customOn && effectiveJoin) {
    const min = statutoryEntitlements(effectiveJoin, Number(todayMYT().slice(0, 4)))
    const annual = days.annual_leave_days ?? Number(before.annual_leave_days)
    const mc = days.mc_days ?? Number(before.mc_days)
    if (annual < min.annual || mc < min.mc) {
      return Response.json({ error: `Below the legal minimum for this person (${min.annual} annual, ${min.mc} MC this year)` }, { status: 400 })
    }
  }

  const patch: Record<string, unknown> = { ...days }
  if (reset_pin) patch.hr_pin_hash = null
  if (join_date !== undefined) patch.join_date = join_date
  if (custom_entitlement !== undefined) patch.custom_entitlement = custom_entitlement
  const { data, error } = await svc.from('xocks_team_members').update(patch).eq('id', memberId).select(MEMBER_COLUMNS).single()
  if (error) return Response.json({ error: 'Update failed', details: error.message }, { status: 500 })

  const actor = { type: 'admin' as const, label: auth.label }
  if (reset_pin) await logHr(svc, request, actor, 'pin.reset', { type: 'member', id: memberId }, { for_member_id: memberId })
  if (join_date !== undefined && join_date !== before.join_date) {
    await logHr(svc, request, actor, 'join_date.changed', { type: 'member', id: memberId },
      { for_member_id: memberId, from: before.join_date, to: join_date })
  }
  if (Object.keys(days).length > 0 || custom_entitlement !== undefined) {
    const b = numMember(before)
    await logHr(svc, request, actor, 'entitlement.changed', { type: 'member', id: memberId }, {
      for_member_id: memberId,
      annual_leave_days: { from: b.annual_leave_days, to: days.annual_leave_days ?? b.annual_leave_days },
      mc_days: { from: b.mc_days, to: days.mc_days ?? b.mc_days },
      custom: { from: b.custom_entitlement, to: custom_entitlement ?? b.custom_entitlement },
    })
  }
  return Response.json({ member: numMember(data) })
}
