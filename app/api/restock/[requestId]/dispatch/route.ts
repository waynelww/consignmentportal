import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const DispatchSchema = z.object({
  courier: z.string().min(1),
  tracking_number: z.string().min(1),
  dispatch_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dispatch_date must be YYYY-MM-DD'),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params

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

  const parsed = DispatchSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { courier, tracking_number, dispatch_date } = parsed.data

  const { data: restockRequest, error: reqErr } = await supabase
    .from('restock_requests')
    .select('id, store_id, status')
    .eq('id', requestId)
    .single()

  if (reqErr || !restockRequest) {
    return Response.json({ error: 'Restock request not found' }, { status: 404 })
  }
  if (restockRequest.status !== 'approved') {
    return Response.json({ error: `Cannot dispatch request with status: ${restockRequest.status}` }, { status: 400 })
  }

  // UPDATE restock_request status
  const { error: updateReqErr } = await supabase
    .from('restock_requests')
    .update({ status: 'dispatched', updated_at: new Date().toISOString() })
    .eq('id', requestId)

  if (updateReqErr) {
    return Response.json({ error: 'Failed to update restock request', details: updateReqErr.message }, { status: 500 })
  }

  // UPDATE linked delivery_order
  const { error: updateDoErr } = await supabase
    .from('delivery_orders')
    .update({
      status: 'dispatched',
      courier,
      tracking_number,
      dispatch_date,
      updated_at: new Date().toISOString(),
    })
    .eq('restock_request_id', requestId)

  if (updateDoErr) {
    return Response.json({ error: 'Failed to update delivery order', details: updateDoErr.message }, { status: 500 })
  }

  // Notify store
  await supabase.from('notifications').insert({
    recipient_role: null,
    recipient_store_id: restockRequest.store_id,
    type: 'do_dispatched',
    title: 'Order Dispatched',
    message: `Your restock order has been dispatched via ${courier}. Tracking: ${tracking_number}`,
    reference_id: requestId,
    reference_type: 'restock_request',
    is_read: false,
  })

  return Response.json({ success: true })
}
