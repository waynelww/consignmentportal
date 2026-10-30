import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseOnboarding, isActiveTeamMember } from '@/lib/onboarding/access'
import { MoveCardSchema } from '@/lib/onboarding/schemas'
import { isOnboardingStep, needsStoreLink, stepLabel, type OnboardingStep } from '@/lib/onboarding/steps'

type Params = { params: Promise<{ cardId: string }> }

/**
 * POST /api/onboarding/cards/[cardId]/move
 * { to_step, by_member_id, store_id? }
 *
 * Changes the step and writes one history row (from, to, who, when). Moving
 * to Account created or later needs a linked store: pass store_id if the card
 * is not linked yet.
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

  const parsed = MoveCardSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const { by_member_id, store_id: requestedStoreId } = parsed.data
  const toStep = parsed.data.to_step
  if (!isOnboardingStep(toStep)) {
    return Response.json({ error: 'Unknown step' }, { status: 400 })
  }

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

  const fromStep = card.step as OnboardingStep
  if (fromStep === toStep) {
    return Response.json({ error: `Card is already at ${stepLabel(toStep)}` }, { status: 400 })
  }

  // Store link: required from Account created on. Either already linked, or given now.
  let storeId: string | null = card.store_id
  if (requestedStoreId && requestedStoreId !== card.store_id) {
    if (card.store_id) {
      return Response.json({ error: 'This card is already linked to a different store' }, { status: 409 })
    }
    const { data: store } = await admin.from('stores').select('id').eq('id', requestedStoreId).maybeSingle()
    if (!store) return Response.json({ error: 'Store not found' }, { status: 400 })
    const { data: linked } = await admin
      .from('onboarding_cards')
      .select('id')
      .eq('store_id', requestedStoreId)
      .maybeSingle()
    if (linked) return Response.json({ error: 'That store is already linked to another card' }, { status: 409 })
    storeId = requestedStoreId
  }
  if (needsStoreLink(toStep) && !storeId) {
    return Response.json(
      { error: `Link the store record before moving to ${stepLabel(toStep)}` },
      { status: 400 },
    )
  }

  const now = new Date().toISOString()
  const nextFirstSaleAt = toStep === 'first_sale' ? now : null

  // Conditional on the step we read: if someone else moved the card meanwhile, nothing changes.
  const { data: moved, error: moveErr } = await admin
    .from('onboarding_cards')
    .update({
      step: toStep,
      step_changed_at: now,
      first_sale_at: nextFirstSaleAt,
      store_id: storeId,
      updated_by_member_id: by_member_id,
      updated_at: now,
    })
    .eq('id', cardId)
    .eq('step', fromStep)
    .select('id')
    .maybeSingle()
  if (moveErr) return Response.json({ error: 'Failed to move card', details: moveErr.message }, { status: 500 })
  if (!moved) {
    return Response.json({ error: 'The card was moved by someone else. Refresh and try again.' }, { status: 409 })
  }

  const { error: historyErr } = await admin.from('onboarding_card_history').insert({
    card_id: cardId,
    from_step: fromStep,
    to_step: toStep,
    moved_by_member_id: by_member_id,
  })
  if (historyErr) {
    // Never leave a step change without its history row: put the card back.
    await admin
      .from('onboarding_cards')
      .update({
        step: fromStep,
        step_changed_at: card.step_changed_at,
        first_sale_at: card.first_sale_at,
        store_id: card.store_id,
        updated_by_member_id: card.updated_by_member_id,
        updated_at: card.updated_at,
      })
      .eq('id', cardId)
      .eq('step', toStep)
    return Response.json(
      { error: 'Move not recorded in history, so it was undone', details: historyErr.message },
      { status: 500 },
    )
  }

  return Response.json({ success: true, step: toStep, store_id: storeId })
}
