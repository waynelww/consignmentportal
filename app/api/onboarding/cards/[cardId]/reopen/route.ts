import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseOnboarding, isActiveTeamMember } from '@/lib/onboarding/access'
import { ReopenCardSchema } from '@/lib/onboarding/schemas'
import { closeReasonLabel, stepLabel, type OnboardingStep } from '@/lib/onboarding/steps'

type Params = { params: Promise<{ cardId: string }> }

/**
 * POST /api/onboarding/cards/[cardId]/reopen  { by_member_id }
 *
 * Puts a removed card back on the board at the step it was closed on. The
 * reopen is written to the history. The linked store (if any) is not changed.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { cardId } = await params
  const auth = await authoriseOnboarding()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ReopenCardSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const { by_member_id } = parsed.data

  if (!(await isActiveTeamMember(by_member_id))) {
    return Response.json({ error: 'Choose who you are (an active Xocks team member)' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: card, error: cardErr } = await admin
    .from('onboarding_cards')
    .select('*')
    .eq('id', cardId)
    .maybeSingle()
  if (cardErr) return Response.json({ error: cardErr.message }, { status: 500 })
  if (!card) return Response.json({ error: 'Card not found' }, { status: 404 })
  if (!card.closed_at) return Response.json({ error: 'This card is not removed from the board' }, { status: 409 })

  const revertCard = () => admin
    .from('onboarding_cards')
    .update({
      closed_at: card.closed_at,
      close_reason: card.close_reason,
      close_note: card.close_note,
      closed_by_member_id: card.closed_by_member_id,
      updated_by_member_id: card.updated_by_member_id,
      updated_at: card.updated_at,
    })
    .eq('id', cardId)

  const now = new Date().toISOString()
  const { data: reopened, error: reopenErr } = await admin
    .from('onboarding_cards')
    .update({
      closed_at: null,
      close_reason: null,
      close_note: null,
      closed_by_member_id: null,
      updated_by_member_id: by_member_id,
      updated_at: now,
    })
    .eq('id', cardId)
    .not('closed_at', 'is', null)
    .select('id')
    .maybeSingle()
  if (reopenErr) return Response.json({ error: 'Failed to reopen card', details: reopenErr.message }, { status: 500 })
  if (!reopened) return Response.json({ error: 'The card was changed by someone else. Refresh and try again.' }, { status: 409 })

  const step = card.step as OnboardingStep
  const { error: historyErr } = await admin.from('onboarding_card_history').insert({
    card_id: cardId,
    from_step: step,
    to_step: step,
    event: 'reopened',
    note: `Back on the board at ${stepLabel(step)} (was removed: ${closeReasonLabel(card.close_reason)})`,
    moved_by_member_id: by_member_id,
  })
  if (historyErr) {
    await revertCard()
    return Response.json({ error: 'Reopen not recorded in history, so it was undone', details: historyErr.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
