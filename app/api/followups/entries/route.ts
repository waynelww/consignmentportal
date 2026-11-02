import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseFollowups, isActiveTeamMember } from '@/lib/followups/access'
import { checkWriteTarget, loadCellPrevious } from '@/lib/followups/load'
import { FOLLOWUP_ITEMS } from '@/lib/followups/build'
import { NOTE_MAX_LENGTH, planEntry } from '@/lib/followups/entry'
import { parseYearMonth } from '@/lib/monthly-report/months'

const EntrySchema = z.object({
  month: z.string(),
  store_id: z.string().uuid().optional(),
  extra_store_id: z.string().uuid().optional(),
  item: z.enum(FOLLOWUP_ITEMS),
  ticked: z.boolean().optional(),
  note: z.string().max(NOTE_MAX_LENGTH, `Note must be ${NOTE_MAX_LENGTH} characters or fewer`).nullable().optional(),
  by_member_id: z.string().uuid(),
}).refine((v) => (v.store_id === undefined) !== (v.extra_store_id === undefined), {
  message: 'Give exactly one of store_id or extra_store_id',
}).refine((v) => v.ticked !== undefined || v.note !== undefined, {
  message: 'Nothing to change',
})

/**
 * POST /api/followups/entries
 * Body: { month, store_id | extra_store_id, item, ticked?, note?, by_member_id }
 * Appends one row to followup_log with the cell's full state after the change.
 * XCMS boxes take notes only; their ticks come from XCMS data.
 */
export async function POST(request: NextRequest) {
  const auth = await authoriseFollowups()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = EntrySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const v = parsed.data

  if (!parseYearMonth(v.month)) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  if (!(await isActiveTeamMember(v.by_member_id))) {
    return Response.json({ error: 'Choose who you are (an active Xocks team member)' }, { status: 400 })
  }

  const target = v.store_id !== undefined
    ? { kind: 'store' as const, id: v.store_id }
    : { kind: 'extra' as const, id: v.extra_store_id! }

  const writable = await checkWriteTarget(target)
  if (!writable.ok) return Response.json({ error: writable.error }, { status: writable.status })

  let prev
  try {
    prev = await loadCellPrevious(v.month, target, v.item)
  } catch (err) {
    return Response.json({ error: 'Failed to read the cell', details: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const plan = planEntry({
    auto: target.kind === 'store',
    prev,
    request: { ticked: v.ticked, note: v.note },
  })
  if (!plan.ok) return Response.json({ error: plan.error }, { status: 400 })

  const { data, error } = await createAdminClient()
    .from('followup_log')
    .insert({
      period_month: v.month,
      store_id: target.kind === 'store' ? target.id : null,
      extra_store_id: target.kind === 'extra' ? target.id : null,
      item: v.item,
      action: plan.action,
      ticked: plan.ticked,
      note: plan.note,
      by_member_id: v.by_member_id,
    })
    .select('id, created_at, action, ticked, note')
    .single()
  if (error || !data) {
    return Response.json({ error: 'Failed to record the change', details: error?.message }, { status: 500 })
  }

  return Response.json({ entry: data }, { status: 201 })
}
