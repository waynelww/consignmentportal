import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { authoriseOnboarding, isActiveTeamMember } from '@/lib/onboarding/access'
import { UpdateCardSchema, clean } from '@/lib/onboarding/schemas'

type Params = { params: Promise<{ cardId: string }> }

const CARD_SELECT = `
  *,
  handler:xocks_team_members!handler_member_id(name),
  store:stores!store_id(store_code, store_name)
`

/** GET — one card with its full step history (oldest first) and who moved each step. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { cardId } = await params
  const auth = await authoriseOnboarding()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data: card, error } = await supabase
    .from('onboarding_cards')
    .select(CARD_SELECT)
    .eq('id', cardId)
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!card) return Response.json({ error: 'Card not found' }, { status: 404 })

  const { data: history, error: historyErr } = await supabase
    .from('onboarding_card_history')
    .select('id, from_step, to_step, moved_at, mover:xocks_team_members!moved_by_member_id(name)')
    .eq('card_id', cardId)
    .order('moved_at', { ascending: true })
  if (historyErr) return Response.json({ error: historyErr.message }, { status: 500 })

  return Response.json({ card, history: history ?? [] })
}

/**
 * PATCH — edit details, notes, follow-up date, handler, or link the store record.
 * Does not change the step (that is the move route, which writes history).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { cardId } = await params
  const auth = await authoriseOnboarding()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateCardSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const { by_member_id, ...fields } = parsed.data

  if (!(await isActiveTeamMember(by_member_id))) {
    return Response.json({ error: 'Choose who you are (an active Xocks team member)' }, { status: 400 })
  }
  if (fields.handler_member_id && !(await isActiveTeamMember(fields.handler_member_id))) {
    return Response.json({ error: 'Handler must be an active Xocks team member' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (fields.store_id) {
    const { data: linked } = await admin
      .from('onboarding_cards')
      .select('id')
      .eq('store_id', fields.store_id)
      .neq('id', cardId)
      .maybeSingle()
    if (linked) return Response.json({ error: 'That store is already linked to another card' }, { status: 409 })

    const { data: store } = await admin.from('stores').select('id').eq('id', fields.store_id).maybeSingle()
    if (!store) return Response.json({ error: 'Store not found' }, { status: 400 })
  }

  // Text fields: blank means cleared (NULL). Required name/phone fields are never blank (schema).
  const update: Record<string, unknown> = {
    updated_by_member_id: by_member_id,
    updated_at: new Date().toISOString(),
  }
  const textFields = [
    'store_name', 'pic_name', 'pic_phone', 'company_name', 'company_address', 'company_email',
    'shipment_address', 'shipment_contact', 'shipment_pic', 'store_type', 'notes',
  ] as const
  for (const key of textFields) {
    if (fields[key] !== undefined) update[key] = clean(fields[key])
  }
  if (fields.follow_up_date !== undefined) update.follow_up_date = fields.follow_up_date
  if (fields.handler_member_id !== undefined) update.handler_member_id = fields.handler_member_id
  if (fields.store_id !== undefined) update.store_id = fields.store_id

  const { data: updated, error } = await admin
    .from('onboarding_cards')
    .update(update)
    .eq('id', cardId)
    .select('id')
    .maybeSingle()
  if (error) return Response.json({ error: 'Failed to save card', details: error.message }, { status: 500 })
  if (!updated) return Response.json({ error: 'Card not found' }, { status: 404 })

  return Response.json({ success: true })
}
