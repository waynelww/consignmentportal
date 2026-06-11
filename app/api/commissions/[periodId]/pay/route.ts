import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const PaySchema = z.object({
  payment_reference: z.string().max(200).optional().nullable(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ periodId: string }> }
) {
  const { periodId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PaySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { payment_reference } = parsed.data

  const { data: period, error: periodErr } = await supabase
    .from('commission_periods')
    .select('id, store_id, status, commission_amount, xocks_revenue, period_month, period_year')
    .eq('id', periodId)
    .single()

  if (periodErr || !period) {
    return Response.json({ error: 'Commission period not found' }, { status: 404 })
  }
  if (period.status === 'paid') {
    return Response.json({ error: 'Period is already marked as paid' }, { status: 400 })
  }

  const ref = parsed.data.payment_reference?.trim() || null

  const { error: updateErr } = await supabase
    .from('commission_periods')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_reference: ref,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', periodId)

  if (updateErr) {
    return Response.json({ error: 'Failed to mark commission as paid', details: updateErr.message }, { status: 500 })
  }

  const xocksAmt = Number(period.xocks_revenue).toFixed(2)
  const refNote = ref ? `. Reference: ${ref}` : ''
  await supabase.from('notifications').insert({
    recipient_role: null,
    recipient_store_id: period.store_id,
    type: 'commission_paid',
    title: 'Payment Confirmed',
    message: `Your payment of RM${xocksAmt} for ${period.period_month}/${period.period_year} has been confirmed. Thank you!${refNote}`,
    reference_id: periodId,
    reference_type: 'commission_period',
    is_read: false,
  })

  return Response.json({ success: true })
}
