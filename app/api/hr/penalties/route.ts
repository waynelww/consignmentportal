import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { isYmd } from '@/lib/hr/rules'
import { PENALTY_COLUMNS } from '@/lib/hr/types'
import { logHr } from '@/lib/hr/audit'

const PenaltySchema = z.object({
  member_id: z.string().uuid(),
  penalty_date: z.string().refine(isYmd, 'Date must be YYYY-MM-DD'),
  kind: z.enum(['late', 'other']).default('late'),
  minutes_late: z.number().int().min(1).max(1440).nullish(),
  amount: z.number().min(0).max(100000),
  note: z.string().trim().max(300).nullish(),
})

/** POST /api/hr/penalties — HR admin logs a late (or other) penalty. */
export async function POST(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = PenaltySchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  const p = parsed.data

  const svc = await createServiceClient()
  const { data, error } = await svc.from('hr_penalties').insert({
    member_id: p.member_id,
    penalty_date: p.penalty_date,
    kind: p.kind,
    minutes_late: p.kind === 'late' ? p.minutes_late ?? null : null,
    amount: Math.round(p.amount * 100) / 100,
    note: p.note || null,
  }).select(PENALTY_COLUMNS).single()
  if (error) return Response.json({ error: 'Failed to log penalty', details: error.message }, { status: 500 })
  await logHr(svc, request, { type: 'admin', label: auth.label }, 'penalty.added', { type: 'penalty', id: data.id },
    { for_member_id: p.member_id, penalty_date: p.penalty_date, kind: p.kind, amount: p.amount })
  return Response.json({ penalty: data }, { status: 201 })
}

/** DELETE /api/hr/penalties?id=UUID — remove a penalty logged by mistake. */
export async function DELETE(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const svc = await createServiceClient()
  const { data: old } = await svc.from('hr_penalties').select('member_id, penalty_date, amount').eq('id', id).maybeSingle()
  const { error } = await svc.from('hr_penalties').delete().eq('id', id)
  if (error) return Response.json({ error: 'Delete failed', details: error.message }, { status: 500 })
  await logHr(svc, request, { type: 'admin', label: auth.label }, 'penalty.deleted', { type: 'penalty', id },
    old ? { for_member_id: old.member_id, penalty_date: old.penalty_date, amount: Number(old.amount) } : null)
  return Response.json({ ok: true })
}
