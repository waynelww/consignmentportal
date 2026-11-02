import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { HR_FILE_TYPES } from '@/lib/hr/access'
import { portalMember } from '@/lib/hr/portal-session'
import { logHr } from '@/lib/hr/audit'
import { CLAIM_CATEGORIES, LEAVE_TYPES, countLeaveDays, isYmd } from '@/lib/hr/rules'
import { loadHolidaySet, loadHrSettings } from '@/lib/hr/settings'
import { CLAIM_COLUMNS, LEAVE_COLUMNS } from '@/lib/hr/types'

const Ymd = z.string().refine(isYmd, 'Date must be YYYY-MM-DD')
// Files are uploaded first via /api/hr-portal/upload-url; the path must sit in the person's folder.
const FileFields = {
  file_path: z.string().max(300).nullish(),
  file_name: z.string().max(200).nullish(),
  file_type: z.string().refine((t) => !!HR_FILE_TYPES[t], 'File type not allowed').nullish(),
}

const ClaimSchema = z.object({
  kind: z.literal('claim'),
  claim_date: Ymd,
  category: z.enum(Object.keys(CLAIM_CATEGORIES) as [keyof typeof CLAIM_CATEGORIES]),
  amount: z.number().positive('Amount must be more than 0').max(100000),
  description: z.string().trim().min(1, 'Say what the claim is for').max(500),
  ...FileFields,
})

const LeaveSchema = z.object({
  kind: z.literal('leave'),
  leave_type: z.enum(Object.keys(LEAVE_TYPES) as [keyof typeof LEAVE_TYPES]),
  start_date: Ymd,
  end_date: Ymd,
  half_day: z.boolean().default(false),
  reason: z.string().trim().max(500).nullish(),
  ...FileFields,
})

/**
 * POST /api/hr-portal/requests — the signed-in person submits a claim
 * ({kind:'claim'}) or leave / MC ({kind:'leave'}). The person always comes
 * from the PIN session, never from the request body.
 */
export async function POST(request: NextRequest) {
  const svc = await createServiceClient()
  const me = await portalMember(request, svc)
  if (!me) return Response.json({ error: 'Signed out. Enter your PIN again.' }, { status: 401 })
  const actor = { type: 'staff' as const, memberId: me.id, label: me.name }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = z.discriminatedUnion('kind', [ClaimSchema, LeaveSchema]).safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const input = parsed.data
  if (input.file_path && !input.file_path.startsWith(`${me.id}/`)) {
    return Response.json({ error: 'File does not belong to this person' }, { status: 400 })
  }

  if (input.kind === 'claim') {
    if (!input.file_path) return Response.json({ error: 'Attach a photo of the receipt' }, { status: 400 })
    const { data, error } = await svc.from('hr_claims').insert({
      member_id: me.id,
      claim_date: input.claim_date,
      category: input.category,
      amount: Math.round(input.amount * 100) / 100,
      description: input.description,
      receipt_path: input.file_path,
      receipt_name: input.file_name ?? null,
      receipt_type: input.file_type ?? null,
    }).select(CLAIM_COLUMNS).single()
    if (error) return Response.json({ error: 'Failed to submit claim', details: error.message }, { status: 500 })
    await logHr(svc, request, actor, 'claim.submitted', { type: 'claim', id: data.id },
      { amount: Number(data.amount), category: data.category, claim_date: data.claim_date })
    return Response.json({ claim: data }, { status: 201 })
  }

  if (input.end_date < input.start_date) return Response.json({ error: 'End date is before start date' }, { status: 400 })
  if (input.half_day && input.start_date !== input.end_date) {
    return Response.json({ error: 'A half day must start and end on the same date' }, { status: 400 })
  }
  if (input.leave_type === 'mc' && !input.file_path) {
    return Response.json({ error: 'Attach a photo of the MC slip' }, { status: 400 })
  }

  const [settings, holidays] = await Promise.all([
    loadHrSettings(svc),
    loadHolidaySet(svc, input.start_date, input.end_date),
  ])
  const days = countLeaveDays(input.start_date, input.end_date, { halfDay: input.half_day, workDays: settings.workDays, holidays })
  if (days === 0) return Response.json({ error: 'Those dates are all weekends or public holidays' }, { status: 400 })

  // Same person, overlapping dates, not rejected → refuse the duplicate.
  const { data: overlap } = await svc.from('hr_leaves').select('id')
    .eq('member_id', me.id).neq('status', 'rejected')
    .lte('start_date', input.end_date).gte('end_date', input.start_date).limit(1)
  if (overlap && overlap.length > 0) {
    return Response.json({ error: 'You already have leave or MC on some of these dates' }, { status: 409 })
  }

  const { data, error } = await svc.from('hr_leaves').insert({
    member_id: me.id,
    leave_type: input.leave_type,
    start_date: input.start_date,
    end_date: input.end_date,
    half_day: input.half_day,
    days,
    reason: input.reason || null,
    attachment_path: input.file_path ?? null,
    attachment_name: input.file_name ?? null,
    attachment_type: input.file_type ?? null,
  }).select(LEAVE_COLUMNS).single()
  if (error) return Response.json({ error: 'Failed to submit leave', details: error.message }, { status: 500 })
  await logHr(svc, request, actor, 'leave.submitted', { type: 'leave', id: data.id },
    { leave_type: data.leave_type, start_date: data.start_date, end_date: data.end_date, days: Number(data.days) })
  return Response.json({ leave: data }, { status: 201 })
}
