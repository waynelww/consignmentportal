import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ doId: string }> }
) {
  const { doId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'store_owner') {
    return Response.json({ error: 'Forbidden: store owners only' }, { status: 403 })
  }

  // Fetch the DO and verify it belongs to this store
  const { data: deliveryOrder, error: doErr } = await supabase
    .from('delivery_orders')
    .select('id, do_number, store_id, status, do_type, total_pairs')
    .eq('id', doId)
    .single()

  if (doErr || !deliveryOrder) {
    return Response.json({ error: 'Delivery order not found' }, { status: 404 })
  }

  if (deliveryOrder.store_id !== profile.store_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!['confirmed', 'dispatched', 'delivered'].includes(deliveryOrder.status)) {
    return Response.json({ error: `Cannot acknowledge a DO with status: ${deliveryOrder.status}` }, { status: 400 })
  }

  // Fetch the DO items
  const { data: items, error: itemsErr } = await supabase
    .from('delivery_order_items')
    .select('product_id, quantity')
    .eq('delivery_order_id', doId)

  if (itemsErr || !items || items.length === 0) {
    return Response.json({ error: 'No items found for this delivery order' }, { status: 400 })
  }

  const movementType = deliveryOrder.do_type === 'initial' ? 'inbound_initial' : 'inbound_restock'

  // Upsert inventory and record stock movements for each item
  for (const item of items) {
    // Get existing inventory row
    const { data: existing } = await supabase
      .from('store_inventory')
      .select('id, quantity_on_hand')
      .eq('store_id', profile.store_id)
      .eq('product_id', item.product_id)
      .single()

    if (existing) {
      await supabase
        .from('store_inventory')
        .update({
          quantity_on_hand: existing.quantity_on_hand + item.quantity,
          last_restocked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      await supabase.from('store_inventory').insert({
        store_id: profile.store_id,
        product_id: item.product_id,
        quantity_on_hand: item.quantity,
        restock_threshold: 5,
        last_restocked_at: new Date().toISOString(),
      })
    }

    await supabase.from('stock_movements').insert({
      store_id: profile.store_id,
      product_id: item.product_id,
      movement_type: movementType,
      quantity: item.quantity,
      reference_id: doId,
      notes: `Acknowledged from DO ${deliveryOrder.do_number}`,
      created_by: user.id,
    })
  }

  // Mark DO as acknowledged
  await supabase
    .from('delivery_orders')
    .update({
      status: 'acknowledged',
      delivery_date: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    })
    .eq('id', doId)

  // Fetch store name for notification
  const { data: store } = await supabase
    .from('stores')
    .select('store_name')
    .eq('id', profile.store_id)
    .single()

  const storeName = store?.store_name ?? 'A store'

  // Notify admins
  await supabase.from('notifications').insert({
    recipient_role: 'super_admin',
    recipient_store_id: null,
    type: 'do_delivered',
    title: 'DO Acknowledged',
    message: `${storeName} confirmed receipt of ${deliveryOrder.do_number} (${deliveryOrder.total_pairs} pairs). Stock has been added.`,
    reference_id: doId,
    reference_type: 'delivery_order',
    is_read: false,
  })

  return Response.json({ success: true, do_number: deliveryOrder.do_number })
}
