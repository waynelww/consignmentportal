import { z } from 'zod'
import { ONBOARDING_STEPS } from '@/lib/onboarding/steps'

const uuid = z.string().uuid()
const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) => text(max).nullable().optional()

/** Blank text is stored as NULL, so "cleared" and "never filled" look the same. */
export function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

// Who is acting: every write records a Xocks team member.
const byMember = { by_member_id: uuid }

export const CreateCardSchema = z.object({
  ...byMember,
  store_name: text(120).min(1, 'Store name is required'),
  pic_name: text(120).min(1, 'PIC name is required'),
  pic_phone: text(30).min(1, 'Phone is required'),
})

export const UpdateCardSchema = z.object({
  ...byMember,
  store_name: text(120).min(1, 'Store name is required').optional(),
  pic_name: text(120).min(1, 'PIC name is required').optional(),
  pic_phone: text(30).min(1, 'Phone is required').optional(),
  company_name: optionalText(200),
  company_address: optionalText(500),
  company_email: optionalText(200),
  shipment_address: optionalText(500),
  shipment_contact: optionalText(200),
  shipment_pic: optionalText(120),
  store_type: optionalText(60),
  notes: optionalText(2000),
  follow_up_date: z.string().date().nullable().optional(),
  handler_member_id: uuid.nullable().optional(),
  store_id: uuid.optional(),
})

export const MoveCardSchema = z.object({
  ...byMember,
  to_step: z.enum(ONBOARDING_STEPS.map((s) => s.key) as [string, ...string[]]),
  // Required when moving to Account created (or later) on a card not yet linked.
  store_id: uuid.optional(),
})
