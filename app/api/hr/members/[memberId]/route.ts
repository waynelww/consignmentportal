import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { logHr } from '@/lib/hr/audit'
import { MEMBER_COLUMNS, numMember } from '@/lib/hr/types'

const Days = z.number().min(0).max(60).refine((n) => Number.isInteger(n * 2), 'Use whole or half days')

/**
 * PATCH /api/hr/members/[memberId]
 *   { annual_leave_days?, mc_days? } — yearly entitlements
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
  }).safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  const { reset_pin, ...days } = parsed.data
  if (!reset_pin && Object.keys(days).length === 0) return Response.json({ error: 'Nothing to update' }, { status: 400 })

  const svc = await createServiceClient()
  const { data: before } = await svc.from('xocks_team_members').select(MEMBER_COLUMNS).eq('id', memberId).maybeSingle()
  if (!before) return Response.json({ error: 'Not found' }, { status: 404 })

  const patch: Record<string, unknown> = { ...days }
  if (reset_pin) patch.hr_pin_hash = null
  const { data, error } = await svc.from('xocks_team_members').update(patch).eq('id', memberId).select(MEMBER_COLUMNS).single()
  if (error) return Response.json({ error: 'Update failed', details: error.message }, { status: 500 })

  const actor = { type: 'admin' as const, label: auth.label }
  if (reset_pin) await logHr(svc, request, actor, 'pin.reset', { type: 'member', id: memberId }, { for_member_id: memberId })
  if (Object.keys(days).length > 0) {
    const b = numMember(before)
    await logHr(svc, request, actor, 'entitlement.changed', { type: 'member', id: memberId }, {
      for_member_id: memberId,
      annual_leave_days: { from: b.annual_leave_days, to: days.annual_leave_days ?? b.annual_leave_days },
      mc_days: { from: b.mc_days, to: days.mc_days ?? b.mc_days },
    })
  }
  return Response.json({ member: numMember(data) })
}
