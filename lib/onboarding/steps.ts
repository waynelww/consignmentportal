// Onboarding pipeline rules. Pure functions only: the API routes, the board
// and the test script all read these, so the rules live in one place.

export const ONBOARDING_STEPS = [
  { key: 'reached_out', label: 'Reached out' },
  { key: 'agreement_made', label: 'Agreement made' },
  { key: 'details_received', label: 'Details received' },
  { key: 'account_created', label: 'Account created' },
  { key: 'group_opened', label: 'Group opened' },
  { key: 'catalogue_sent', label: 'Catalogue sent' },
  { key: 'stock_picked', label: 'Stock picked' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'first_sale', label: 'First sale' },
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]['key']

export const FIRST_STEP: OnboardingStep = 'reached_out'
export const LAST_STEP: OnboardingStep = 'first_sale'

/** Steps from Account created onwards need a linked store record. */
export const STORE_LINK_FROM_STEP: OnboardingStep = 'account_created'

/** A card that has sat on one step this long turns red. */
export const STALE_STEP_MS = 24 * 60 * 60 * 1000

/** A card at First sale leaves the board this long after reaching it (still searchable). */
export const FIRST_SALE_HIDE_MS = 7 * 24 * 60 * 60 * 1000

const MYT_TIME_ZONE = 'Asia/Kuala_Lumpur'

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && ONBOARDING_STEPS.some((s) => s.key === value)
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.findIndex((s) => s.key === step)
}

export function stepLabel(step: OnboardingStep): string {
  return ONBOARDING_STEPS[stepIndex(step)]?.label ?? step
}

/** The step after this one, or null on First sale. */
export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) + 1]?.key ?? null
}

/** True when moving to this step requires the card to be linked to a store. */
export function needsStoreLink(step: OnboardingStep): boolean {
  return stepIndex(step) >= stepIndex(STORE_LINK_FROM_STEP)
}

/** Today's date in Malaysia as YYYY-MM-DD (the date used for follow-ups). */
export function todayMYT(now: Date): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: MYT_TIME_ZONE }).format(now)
}

/** Whole days since the card moved onto its current step. */
export function daysOnStep(stepChangedAt: string, now: Date): number {
  const ms = now.getTime() - new Date(stepChangedAt).getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

export interface OnboardingCardTiming {
  step: OnboardingStep
  step_changed_at: string
  follow_up_date: string | null
  first_sale_at: string | null
}

/**
 * Red = needs chasing. Only open cards can be red: a card on First sale is
 * finished. Open when it has sat on the same step for more than 24 hours, or
 * its follow-up date (Malaysia date) has passed.
 */
export function isRedCard(card: OnboardingCardTiming, now: Date): boolean {
  if (card.step === LAST_STEP) return false
  const onStepMs = now.getTime() - new Date(card.step_changed_at).getTime()
  if (onStepMs > STALE_STEP_MS) return true
  return card.follow_up_date !== null && card.follow_up_date < todayMYT(now)
}

/** Finished cards (First sale) drop off the board after 7 days; they stay searchable. */
export function isOffBoard(card: OnboardingCardTiming, now: Date): boolean {
  if (card.step !== LAST_STEP || !card.first_sale_at) return false
  return now.getTime() - new Date(card.first_sale_at).getTime() > FIRST_SALE_HIDE_MS
}

/** Oldest first: the card that has waited longest on its step comes first. */
export function compareOldestFirst(a: { step_changed_at: string }, b: { step_changed_at: string }): number {
  return new Date(a.step_changed_at).getTime() - new Date(b.step_changed_at).getTime()
}
