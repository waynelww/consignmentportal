import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { authoriseOnboarding, isActiveTeamMember } from '@/lib/onboarding/access'
import { CreateCardSchema, clean } from '@/lib/onboarding/schemas'

const CARD_SELECT = `
  *,
  handler:xocks_team_members!handler_member_id(name),
  closer:xocks_team_members!closed_by_member_id(name),
  store:stores!store_id(store_code, store_name)
`

/**
 * GET  /api/onboarding/cards — every card (the board filters them).
 * POST /api/onboarding/cards — add a card at Reached out, with its first history row.
 */
export async function GET(_request: NextRequest) {
  const auth = await authoriseOnboarding()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('onboarding_cards')
    .select(CARD_SELECT)
    .order('step_changed_at', { ascending: true })
    .limit(1000)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ cards: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await authoriseOnboarding()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateCardSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const { by_member_id, store_name, pic_name, pic_phone } = parsed.data

  if (!(await isActiveTeamMember(by_member_id))) {
    return Response.json({ error: 'Choose who you are (an active Xocks team member)' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: card, error } = await admin
    .from('onboarding_cards')
    .insert({
      store_name: clean(store_name),
      pic_name: clean(pic_name),
      pic_phone: clean(pic_phone),
      step: 'reached_out',
      updated_by_member_id: by_member_id,
    })
    .select('id')
    .single()
  if (error || !card) {
    return Response.json({ error: 'Failed to add store', details: error?.message }, { status: 500 })
  }

  const { error: historyErr } = await admin.from('onboarding_card_history').insert({
    card_id: card.id,
    from_step: null,
    to_step: 'reached_out',
    moved_by_member_id: by_member_id,
  })
  if (historyErr) {
    // The card exists without its first history row. Nothing is deleted here
    // (the handbook forbids it without approval); the error names the card.
    return Response.json(
      { error: 'Card created but its history row failed', card_id: card.id, details: historyErr.message },
      { status: 500 },
    )
  }

  return Response.json({ card_id: card.id }, { status: 201 })
}
