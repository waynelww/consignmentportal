/**
 * POST /api/payments/receipts/[receiptId]/review
 * Admin confirms or rejects a submitted payment receipt.
 *
 * confirm → receipt 'confirmed' + commission period 'paid' (paid_at,
 *           payment_reference from the receipt's bank reference), store
 *           notified with a thank-you.
 * reject  → receipt 'rejected' with admin notes, period left unpaid, store
 *           notified so they can re-submit.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const Schema = z.object({
  action: z.enum(['confirm', 'reject']),
  admin_notes: z.string().max(500).optional().nullable(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const { receiptId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }
  if (parsed.data.action === 'reject' && !parsed.data.admin_notes?.trim()) {
    return Response.json({ error: 'Please tell the store why the receipt was rejected' }, { status: 400 })
  }

  const svc = await createServiceClient()
  const { data: receipt } = await svc
    .from('payment_receipts')
    .select('id, commission_period_id, store_id, status, bank_reference')
    .eq('id', receiptId)
    .single()
  if (!receipt) return Response.json({ error: 'Receipt not found' }, { status: 404 })
  if (receipt.status === 'confirmed') {
    return Response.json({ error: 'Receipt already confirmed' }, { status: 400 })
  }

  const { data: period } = await svc
    .from('commission_periods')
    .select('id, period_month, period_year, xocks_revenue, status')
    .eq('id', receipt.commission_period_id)
    .single()
  if (!period) return Response.json({ error: 'Invoice not found' }, { status: 404 })

  const now = new Date().toISOString()
  const periodLabel = `${period.period_month}/${period.period_year}`

  // Update the receipt first
  const { error: rcptErr } = await svc
    .from('payment_receipts')
    .update({
      status: parsed.data.action === 'confirm' ? 'confirmed' : 'rejected',
      admin_notes: parsed.data.admin_notes ?? null,
      reviewed_by: user.id,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', receiptId)
  if (rcptErr) {
    return Response.json({ error: 'Failed to update receipt', details: rcptErr.message }, { status: 500 })
  }

  if (parsed.data.action === 'confirm') {
    // Mark the invoice paid; keep approval fields coherent if it skipped 'approved'
    const { error: periodErr } = await svc
      .from('commission_periods')
      .update({
        status: 'paid',
        paid_at: now,
        payment_reference: receipt.bank_reference || `Receipt ${receiptId.slice(0, 8)}`,
        approved_by: user.id,
        approved_at: now,
      })
      .eq('id', period.id)
    if (periodErr) {
      return Response.json({ error: 'Receipt confirmed but invoice update failed', details: periodErr.message }, { status: 500 })
    }

    await svc.from('notifications').insert({
      recipient_role: null,
      recipient_store_id: receipt.store_id,
      type: 'payment_receipt_confirmed',
      title: 'Payment Confirmed',
      message: `Your payment of RM ${Number(period.xocks_revenue).toFixed(2)} for ${periodLabel} has been confirmed. Thank you!`,
      reference_id: period.id,
      reference_type: 'commission_period',
      is_read: false,
    })
  } else {
    await svc.from('notifications').insert({
      recipient_role: null,
      recipient_store_id: receipt.store_id,
      type: 'payment_receipt_rejected',
      title: 'Payment Receipt Rejected',
      message: `Your receipt for ${periodLabel} was rejected: ${parsed.data.admin_notes}. Please upload a new receipt.`,
      reference_id: period.id,
      reference_type: 'commission_period',
      is_read: false,
    })
  }

  return Response.json({ success: true, action: parsed.data.action })
}
