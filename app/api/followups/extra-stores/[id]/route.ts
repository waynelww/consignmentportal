import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseFollowups, isActiveTeamMember } from '@/lib/followups/access'

const UpdateSchema = z.object({
  active: z.boolean(),
  by_member_id: z.string().uuid(),
})

/**
 * PATCH /api/followups/extra-stores/:id  { active, by_member_id }
 * Hide (active: false) or restore (active: true) an extra store. Nothing is
 * deleted: a hidden store keeps every past tick, and the change is recorded.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authoriseFollowups()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'Invalid store id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const { active, by_member_id } = parsed.data

  if (!(await isActiveTeamMember(by_member_id))) {
    return Response.json({ error: 'Choose who you are (an active Xocks team member)' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: current } = await admin.from('followup_extra_stores').select('id, active').eq('id', id).maybeSingle()
  if (!current) return Response.json({ error: 'Store not found' }, { status: 404 })
  if (current.active === active) {
    return Response.json({ error: active ? 'Store is already on the list' : 'Store is already hidden' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('followup_extra_stores')
    .update({ active })
    .eq('id', id)
    .select('id, name, pic_name, pic_phone, active')
    .single()
  if (error?.code === '23505') {
    return Response.json({ error: 'Another active store already has this name. Rename it first.' }, { status: 409 })
  }
  if (error || !data) {
    return Response.json({ error: 'Failed to update store', details: error?.message }, { status: 500 })
  }

  const { error: historyErr } = await admin.from('followup_extra_store_history').insert({
    extra_store_id: id,
    action: active ? 'restored' : 'hidden',
    by_member_id,
  })
  if (historyErr) {
    return Response.json(
      { error: 'Store updated but its history row failed', details: historyErr.message, store: data },
      { status: 500 },
    )
  }

  return Response.json({ store: data })
}
