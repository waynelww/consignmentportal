import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  _request: NextRequest,
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

  const { data: restockRequest, error: reqErr } = await supabase
    .from('restock_requests')
    .select('id, store_id, status')
    .eq('id', requestId)
    .single()

  if (reqErr || !restockRequest) {
    return Response.json({ error: 'Restock request not found' }, { status: 404 })
  }

  if (profile.role === 'store_owner' && profile.store_id !== restockRequest.store_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (profile.role !== 'store_owner' && profile.role !== 'ops_manager' && profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (restockRequest.status !== 'dispatched') {
    return Response.json({ error: `Cannot receive request with status: ${restockRequest.status}` }, { status: 400 })
  }

  // UPDATE restock_request status
  const { error: updateReqErr } = await supabase
    .from('restock_requests')
    .update({ status: 'received', updated_at: new Date().toISOString() })
    .eq('id', requestId)

  if (updateReqErr) {
    return Response.json({ error: 'Failed to update restock request', details: updateReqErr.message }, { status: 500 })
  }

  // Fetch and UPDATE linked delivery_order
  const { data: deliveryOrder } = await supabase
    .from('delivery_orders')
    .select('id')
    .eq('restock_request_id', requestId)
    .single()

  if (deliveryOrder) {
    await supabase
      .from('delivery_orders')
      .update({ status: 'acknowledged', updated_at: new Date().toISOString() })
      .eq('id', deliveryOrder.id)
  }

  // Fetch restock request items
  const { data: requestItems, error: itemsErr } = await supabase
    .from('restock_request_items')
    .select('id, product_id, quantity_approved')
    .eq('restock_request_id', requestId)

  if (itemsErr || !requestItems) {
    return Response.json({ error: 'Failed to fetch request items', details: itemsErr?.message }, { status: 500 })
  }

  const now = new Date().toISOString()
  const productIds: string[] = []

  for (const item of requestItems) {
    if (!item.quantity_approved || item.quantity_approved <= 0) continue

    productIds.push(item.product_id)

    // UPDATE store_inventory
    const { data: inv } = await supabase
      .from('store_inventory')
      .select('id, quantity_on_hand')
      .eq('store_id', restockRequest.store_id)
      .eq('product_id', item.product_id)
      .single()

    if (inv) {
      await supabase
        .from('store_inventory')
        .update({
          quantity_on_hand: inv.quantity_on_hand + item.quantity_approved,
          last_restocked_at: now,
          updated_at: now,
        })
        .eq('id', inv.id)
    }

    // INSERT stock_movement
    await supabase.from('stock_movements').insert({
      store_id: restockRequest.store_id,
      product_id: item.product_id,
      movement_type: 'inbound_restock',
      quantity: item.quantity_approved,
      reference_id: requestId,
      notes: `Restock received for request ${requestId}`,
      created_by: user.id,
    })
  }

  // UPDATE restock_alerts for fulfilled products
  if (productIds.length > 0) {
    await supabase
      .from('restock_alerts')
      .update({ status: 'fulfilled' })
      .eq('store_id', restockRequest.store_id)
      .in('product_id', productIds)
      .eq('status', 'pending')
  }

  // Notify admins
  await supabase.from('notifications').insert({
    recipient_role: 'ops_manager',
    recipient_store_id: null,
    type: 'do_delivered',
    title: 'Restock Received',
    message: `Store ${restockRequest.store_id} has confirmed receipt of restock request ${requestId}`,
    reference_id: requestId,
    reference_type: 'restock_request',
    is_read: false,
  })

  return Response.json({ success: true })
}
