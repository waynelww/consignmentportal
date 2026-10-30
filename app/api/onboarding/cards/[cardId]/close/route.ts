import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseOnboarding, isActiveTeamMember } from '@/lib/onboarding/access'
import { CloseCardSchema, clean } from '@/lib/onboarding/schemas'
import { closeReasonLabel, type OnboardingStep } from '@/lib/onboarding/steps'

type Params = { params: Promise<{ cardId: string }> }

/**
 * POST /api/onboarding/cards/[cardId]/close
 * { reason, by_member_id, note?, set_store_inactive? }
 *
 * Removes the card from the board. Nothing is deleted: the card keeps its step,
 * and the close is written to the history. If the card is linked to a store and
 * set_store_inactive is true, the store's status becomes inactive (the store
 * record stays).
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

  const parsed = CloseCardSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const { by_member_id, reason, note, set_store_inactive } = parsed.data

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
  if (card.closed_at) return Response.json({ error: 'This card is already removed from the board' }, { status: 409 })

  if (set_store_inactive && !card.store_id) {
    return Response.json({ error: 'This card has no store linked, so there is no store to set inactive' }, { status: 400 })
  }

  let store: { id: string; store_code: string; status: string } | null = null
  if (set_store_inactive && card.store_id) {
    const { data: found, error: storeErr } = await admin
      .from('stores')
      .select('id, store_code, status')
      .eq('id', card.store_id)
      .maybeSingle()
    if (storeErr || !found) return Response.json({ error: 'Linked store not found' }, { status: 500 })
    store = found
  }

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

  // 1. Close the card, only if it is still open.
  const now = new Date().toISOString()
  const { data: closed, error: closeErr } = await admin
    .from('onboarding_cards')
    .update({
      closed_at: now,
      close_reason: reason,
      close_note: clean(note),
      closed_by_member_id: by_member_id,
      updated_by_member_id: by_member_id,
      updated_at: now,
    })
    .eq('id', cardId)
    .is('closed_at', null)
    .select('id')
    .maybeSingle()
  if (closeErr) return Response.json({ error: 'Failed to remove card', details: closeErr.message }, { status: 500 })
  if (!closed) return Response.json({ error: 'The card was changed by someone else. Refresh and try again.' }, { status: 409 })

  // 2. Optionally set the linked store inactive. Never deleted.
  if (store) {
    const { error: storeUpdateErr } = await admin
      .from('stores')
      .update({ status: 'inactive', updated_at: now })
      .eq('id', store.id)
    if (storeUpdateErr) {
      await revertCard()
      return Response.json({ error: 'Failed to set the store inactive', details: storeUpdateErr.message }, { status: 500 })
    }
  }

  // 3. Record the close in the history. The step is unchanged: from and to are the step it was closed on.
  const historyNote = [
    `Removed from board: ${closeReasonLabel(reason)}`,
    clean(note),
    store ? `Store ${store.store_code} set to inactive.` : null,
  ].filter(Boolean).join(' — ')
  const { error: historyErr } = await admin.from('onboarding_card_history').insert({
    card_id: cardId,
    from_step: card.step as OnboardingStep,
    to_step: card.step as OnboardingStep,
    event: 'closed',
    note: historyNote,
    moved_by_member_id: by_member_id,
  })
  if (historyErr) {
    // Undo the store change and the card close, so nothing happens without its history row.
    if (store) {
      await admin.from('stores').update({ status: store.status, updated_at: now }).eq('id', store.id)
    }
    await revertCard()
    return Response.json({ error: 'Close not recorded in history, so it was undone', details: historyErr.message }, { status: 500 })
  }

  return Response.json({ success: true, store_set_inactive: !!store })
}
