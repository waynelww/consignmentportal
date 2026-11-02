import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseFollowups, isActiveTeamMember } from '@/lib/followups/access'

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`).nullable().optional()
    .transform((v) => (v && v.length > 0 ? v : null))

const AddSchema = z.object({
  name: z.string().trim().min(1, 'Store name is required').max(120, 'Store name must be 120 characters or fewer'),
  pic_name: optionalText(120, 'PIC name'),
  pic_phone: optionalText(30, 'PIC phone'),
  by_member_id: z.string().uuid(),
})

/**
 * POST /api/followups/extra-stores
 * Body: { name, pic_name?, pic_phone?, by_member_id }
 * Adds a store that is not in XCMS. It stays on every month's checklist until hidden.
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
  const parsed = AddSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const v = parsed.data

  if (!(await isActiveTeamMember(v.by_member_id))) {
    return Response.json({ error: 'Choose who you are (an active Xocks team member)' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: store, error } = await admin
    .from('followup_extra_stores')
    .insert({ name: v.name, pic_name: v.pic_name, pic_phone: v.pic_phone })
    .select('id, name, pic_name, pic_phone, active')
    .single()
  if (error?.code === '23505') {
    return Response.json({ error: 'A store with this name is already on the follow-up list' }, { status: 409 })
  }
  if (error || !store) {
    return Response.json({ error: 'Failed to add store', details: error?.message }, { status: 500 })
  }

  const { error: historyErr } = await admin.from('followup_extra_store_history').insert({
    extra_store_id: store.id,
    action: 'added',
    by_member_id: v.by_member_id,
  })
  if (historyErr) {
    // The store exists without its history row. Nothing is deleted here (the
    // handbook forbids it without approval); the response names the store.
    return Response.json(
      { error: 'Store added but its history row failed', extra_store_id: store.id, details: historyErr.message },
      { status: 500 },
    )
  }

  return Response.json({ store }, { status: 201 })
}
