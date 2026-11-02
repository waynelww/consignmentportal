import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { isYmd } from '@/lib/hr/rules'
import { logHr } from '@/lib/hr/audit'

const HolidaySchema = z.object({
  holiday_date: z.string().refine(isYmd, 'Date must be YYYY-MM-DD'),
  name: z.string().trim().min(1, 'Name is required').max(80),
})

/**
 * POST /api/hr/holidays { holiday_date, name } — add a public holiday.
 * Leave already submitted keeps the day count it was submitted with.
 */
export async function POST(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = HolidaySchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })

  const svc = await createServiceClient()
  const { data, error } = await svc.from('hr_public_holidays')
    .insert(parsed.data).select('id, holiday_date, name').single()
  if (error?.code === '23505') return Response.json({ error: 'That date is already a holiday' }, { status: 409 })
  if (error) return Response.json({ error: 'Failed to add holiday', details: error.message }, { status: 500 })
  await logHr(svc, request, { type: 'admin', label: auth.label }, 'holiday.added', { type: 'holiday', id: data.id }, parsed.data)
  return Response.json({ holiday: data }, { status: 201 })
}

/** DELETE /api/hr/holidays?id=UUID */
export async function DELETE(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const svc = await createServiceClient()
  const { data: old } = await svc.from('hr_public_holidays').select('holiday_date, name').eq('id', id).maybeSingle()
  const { error } = await svc.from('hr_public_holidays').delete().eq('id', id)
  if (error) return Response.json({ error: 'Delete failed', details: error.message }, { status: 500 })
  await logHr(svc, request, { type: 'admin', label: auth.label }, 'holiday.deleted', { type: 'holiday', id }, old)
  return Response.json({ ok: true })
}
