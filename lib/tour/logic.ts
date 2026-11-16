// Pure helpers for the store owner tour. Client-safe, no I/O.

import type { TourStatus } from '@/types'
import { needsStoreSignature, type SignableDO } from '@/lib/delivery-orders/initial-signature'
import { TOUR_STEPS, type TourStep } from './content'

export type PromptKind = 'welcome' | 'offer' | 'resume'

/** Which prompt to show automatically for a status, or null for none. */
export function promptFor(status: TourStatus | null | undefined): PromptKind | null {
  switch (status) {
    case 'new': return 'welcome'
    case 'offer':
    case 'snoozed': return 'offer'
    case 'in_progress': return 'resume'
    default: return null // completed, declined, or no tour data
  }
}

/** Steps for this run. Step 15 is dropped when there is no unsigned first DO. */
export function activeSteps(hasUnsignedFirstDO: boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => !s.onlyIfUnsignedFirstDO || hasUnsignedFirstDO)
}

/** Index in `steps` of the first step at or after `stepId`, or 0. */
export function startIndex(steps: TourStep[], stepId?: number | null): number {
  if (!stepId) return 0
  const i = steps.findIndex((s) => s.id >= stepId)
  return i < 0 ? 0 : i
}

/** True when any of the store's delivery orders is a first DO still needing the store's signature. */
export function hasUnsignedFirstDO(rows: SignableDO[]): boolean {
  return rows.some(needsStoreSignature)
}

/** Read-only status line for the admin Overview. */
export function describeTourStatus(
  status: TourStatus | null | undefined,
  step: number | null | undefined,
  completedAt: string | null | undefined,
  formatDate: (iso: string) => string,
): string {
  switch (status) {
    case 'new':
    case 'offer': return 'Not started'
    case 'snoozed': return 'Snoozed'
    case 'declined': return 'Declined'
    case 'in_progress': return `In progress at step ${step ?? 1}`
    case 'completed': return completedAt ? `Completed on ${formatDate(completedAt)}` : 'Completed'
    default: return 'No tour data'
  }
}
