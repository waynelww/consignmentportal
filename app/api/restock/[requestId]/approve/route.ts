import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { insertWithSequenceCode } from '@/lib/sequence-code'

const ApproveSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    quantity_approved: z.number().int().nonnegative(),
  })).min(1),
  admin_notes: z.string().optional(),
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

  const parsed = ApproveSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { items, admin_notes } = parsed.data

  // Verify restock request exists and is pending
  const { data: restockRequest, error: reqErr } = await supabase
    .from('restock_requests')
    .select('id, store_id, status')
    .eq('id', requestId)
    .single()

  if (reqErr || !restockRequest) {
    return Response.json({ error: 'Restock request not found' }, { status: 404 })
  }
  if (restockRequest.status !== 'pending') {
    return Response.json({ error: `Cannot approve request with status: ${restockRequest.status}` }, { status: 400 })
  }

  // UPDATE restock_request
  const { error: updateReqErr } = await supabase
    .from('restock_requests')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      admin_notes: admin_notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  if (updateReqErr) {
    return Response.json({ error: 'Failed to update restock request', details: updateReqErr.message }, { status: 500 })
  }

  // UPDATE each item quantity_approved
  for (const item of items) {
    await supabase
      .from('restock_request_items')
      .update({ quantity_approved: item.quantity_approved })
      .eq('id', item.id)
      .eq('restock_request_id', requestId)
  }

  const totalPairs = items.reduce((sum, i) => sum + i.quantity_approved, 0)
  const year = new Date().getFullYear()

  // INSERT delivery_order
  const { data: deliveryOrder, error: doErr, code: doNumber } = await insertWithSequenceCode<{ id: string }>({
    supabase,
    table: 'delivery_orders',
    column: 'do_number',
    prefix: `DO-${year}-`,
    padLength: 4,
    insertFn: (doNumber) =>
      supabase
        .from('delivery_orders')
        .insert({
          do_number: doNumber,
          store_id: restockRequest.store_id,
          restock_request_id: requestId,
          do_type: 'restock',
          status: 'confirmed',
          total_pairs: totalPairs,
          created_by: user.id,
        })
        .select('id')
        .single(),
  })

  if (doErr || !deliveryOrder) {
    return Response.json({ error: 'Failed to create delivery order', details: doErr?.message }, { status: 500 })
  }

  // Fetch request items to get product details
  const { data: requestItems } = await supabase
    .from('restock_request_items')
    .select('product_id, quantity_approved, products:product_id ( cost_price )')
    .eq('restock_request_id', requestId)

  const doItems = (requestItems ?? []).map((ri) => ({
    delivery_order_id: deliveryOrder.id,
    product_id: ri.product_id,
    quantity: ri.quantity_approved ?? 0,
    unit_cost: (ri.products as unknown as { cost_price: number } | null)?.cost_price ?? 0,
  }))

  if (doItems.length > 0) {
    await supabase.from('delivery_order_items').insert(doItems)
  }

  // Notify store
  await supabase.from('notifications').insert({
    recipient_role: null,
    recipient_store_id: restockRequest.store_id,
    type: 'do_dispatched',
    title: 'Restock Request Approved',
    message: `Your restock request has been approved. Delivery order ${doNumber} is being prepared.`,
    reference_id: deliveryOrder.id,
    reference_type: 'delivery_order',
    is_read: false,
  })

  return Response.json({ success: true, delivery_order_id: deliveryOrder.id })
}
