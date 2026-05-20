// @ts-nocheck — raw Supabase JS client used here for service-role writes; DB types not needed
import { type NextRequest } from 'next/server'
import { createClient as createSSRClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

// Service-role admin client — bypasses all RLS
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdminClient(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars (URL or SERVICE_ROLE_KEY)')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ doId: string }> }
) {
  const { doId } = await params

  // 1. Validate user identity via SSR client (reads session cookie)
  const ssr = await createSSRClient()
  const { data: { user }, error: authErr } = await ssr.auth.getUser()
  if (authErr || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile, error: profileErr } = await ssr
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) {
    return Response.json({ error: 'Profile not found' }, { status: 403 })
  }
  if (profile.role !== 'store_owner') {
    return Response.json({ error: 'Forbidden: store owners only' }, { status: 403 })
  }
  if (!profile.store_id) {
    return Response.json({ error: 'No store assigned to your account' }, { status: 403 })
  }

  // 2. All DB writes use the service-role admin client (bypasses RLS)
  let admin: ReturnType<typeof createClient>
  try {
    admin = getAdminClient()
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Server config error' }, { status: 500 })
  }

  // 3. Fetch the DO and confirm it belongs to this store
  const { data: deliveryOrder, error: doErr } = await admin
    .from('delivery_orders')
    .select('id, do_number, store_id, status, do_type, total_pairs')
    .eq('id', doId)
    .single()

  if (doErr || !deliveryOrder) {
    return Response.json({ error: 'Delivery order not found' }, { status: 404 })
  }
  if (deliveryOrder.store_id !== profile.store_id) {
    return Response.json({ error: 'This delivery order does not belong to your store' }, { status: 403 })
  }
  if (!['confirmed', 'dispatched', 'delivered'].includes(deliveryOrder.status)) {
    return Response.json({
      error: `Cannot receive a DO with status "${deliveryOrder.status}". Only confirmed, dispatched, or delivered DOs can be received.`
    }, { status: 400 })
  }

  // 4. Fetch the DO items
  const { data: items, error: itemsErr } = await admin
    .from('delivery_order_items')
    .select('product_id, quantity')
    .eq('delivery_order_id', doId)

  if (itemsErr) {
    return Response.json({ error: `Failed to fetch items: ${itemsErr.message}` }, { status: 500 })
  }
  if (!items || items.length === 0) {
    return Response.json({ error: 'This delivery order has no items' }, { status: 400 })
  }

  const movementType = deliveryOrder.do_type === 'initial' ? 'inbound_initial' : 'inbound_restock'
  const errors: string[] = []

  // 5. Add stock for each item
  for (const item of items) {
    // Check for existing inventory row
    const { data: existing, error: invReadErr } = await admin
      .from('store_inventory')
      .select('id, quantity_on_hand')
      .eq('store_id', profile.store_id)
      .eq('product_id', item.product_id)
      .maybeSingle()

    if (invReadErr) {
      errors.push(`inventory read error for product ${item.product_id}: ${invReadErr.message}`)
      continue
    }

    if (existing) {
      const { error: updErr } = await admin
        .from('store_inventory')
        .update({
          quantity_on_hand: existing.quantity_on_hand + item.quantity,
          last_restocked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (updErr) errors.push(`inventory update error for product ${item.product_id}: ${updErr.message}`)
    } else {
      const { error: insErr } = await admin
        .from('store_inventory')
        .insert({
          store_id: profile.store_id,
          product_id: item.product_id,
          quantity_on_hand: item.quantity,
          restock_threshold: 5,
          last_restocked_at: new Date().toISOString(),
        })

      if (insErr) errors.push(`inventory insert error for product ${item.product_id}: ${insErr.message}`)
    }

    const { error: mvErr } = await admin.from('stock_movements').insert({
      store_id: profile.store_id,
      product_id: item.product_id,
      movement_type: movementType,
      quantity: item.quantity,
      reference_id: doId,
      notes: `Received from DO ${deliveryOrder.do_number}`,
      created_by: user.id,
    })
    if (mvErr) errors.push(`stock movement error for product ${item.product_id}: ${mvErr.message}`)
  }

  if (errors.length > 0) {
    return Response.json({ error: 'Some inventory updates failed', details: errors }, { status: 500 })
  }

  // 6. Mark DO as acknowledged
  const { error: doUpdateErr } = await admin
    .from('delivery_orders')
    .update({
      status: 'acknowledged',
      delivery_date: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    })
    .eq('id', doId)

  if (doUpdateErr) {
    return Response.json({ error: `Failed to update DO status: ${doUpdateErr.message}` }, { status: 500 })
  }

  // 7. Notify admins
  const { data: store } = await admin
    .from('stores')
    .select('store_name')
    .eq('id', profile.store_id)
    .single()

  await admin.from('notifications').insert({
    recipient_role: 'super_admin',
    recipient_store_id: null,
    type: 'do_delivered',
    title: 'Stock Received by Store',
    message: `${store?.store_name ?? 'A store'} confirmed receipt of ${deliveryOrder.do_number} (${deliveryOrder.total_pairs} pairs). Stock added to their inventory.`,
    reference_id: doId,
    reference_type: 'delivery_order',
    is_read: false,
  })

  return Response.json({ success: true, do_number: deliveryOrder.do_number, items_received: items.length })
}
