import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function calcCommission(totalAmount: number, commissionRate: number) {
  const commission = Number((totalAmount * commissionRate / 100).toFixed(2))
  return { commission_amount: commission, xocks_revenue: Number((totalAmount - commission).toFixed(2)) }
}

const EditSaleSchema = z.object({
  quantity: z.number().int().positive(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ saleId: string }> }
) {
  const { saleId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = EditSaleSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { quantity: newQuantity } = parsed.data

  // Fetch the existing sale
  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .select('id, store_id, product_id, quantity, unit_price')
    .eq('id', saleId)
    .single()

  if (saleErr || !sale) {
    return Response.json({ error: 'Sale not found' }, { status: 404 })
  }

  // Authorization check
  if (profile.role === 'store_owner' && profile.store_id !== sale.store_id) {
    return Response.json({ error: 'Forbidden: cannot edit sales for another store' }, { status: 403 })
  }
  if (profile.role !== 'store_owner' && profile.role !== 'ops_manager' && profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()

  // Fetch store commission rate
  const { data: store, error: storeErr } = await adminClient
    .from('stores')
    .select('commission_rate')
    .eq('id', sale.store_id)
    .single()

  if (storeErr || !store) {
    return Response.json({ error: 'Store not found' }, { status: 404 })
  }

  // Fetch current inventory
  const { data: inv, error: invErr } = await supabase
    .from('store_inventory')
    .select('id, quantity_on_hand, restock_threshold')
    .eq('store_id', sale.store_id)
    .eq('product_id', sale.product_id)
    .single()

  if (invErr || !inv) {
    return Response.json({ error: 'Inventory not found' }, { status: 404 })
  }

  const oldQuantity = sale.quantity
  const delta = newQuantity - oldQuantity // positive = more sold, negative = returned

  // If selling more, check stock availability
  if (delta > 0 && inv.quantity_on_hand < delta) {
    return Response.json({
      error: 'Insufficient stock for quantity increase',
      available: inv.quantity_on_hand,
      delta,
    }, { status: 400 })
  }

  // Recalculate totals
  const total_amount = Number((newQuantity * sale.unit_price).toFixed(2))
  const { commission_amount, xocks_revenue } = calcCommission(total_amount, store.commission_rate)

  // UPDATE sale record
  const { error: updateSaleErr } = await supabase
    .from('sales')
    .update({ quantity: newQuantity, total_amount, commission_amount, xocks_revenue })
    .eq('id', saleId)

  if (updateSaleErr) {
    return Response.json({ error: 'Failed to update sale', details: updateSaleErr.message }, { status: 500 })
  }

  const new_quantity_on_hand = inv.quantity_on_hand - delta

  // UPDATE inventory via adminClient
  const { error: updateInvErr } = await adminClient
    .from('store_inventory')
    .update({ quantity_on_hand: new_quantity_on_hand, updated_at: new Date().toISOString() })
    .eq('id', inv.id)

  if (updateInvErr) {
    return Response.json({ error: 'Failed to update inventory', details: updateInvErr.message }, { status: 500 })
  }

  // Log stock adjustment movement
  // delta > 0 = more stock taken (adjustment_remove); delta < 0 = stock returned (adjustment_add)
  if (delta !== 0) {
    await adminClient.from('stock_movements').insert({
      store_id: sale.store_id,
      product_id: sale.product_id,
      movement_type: delta > 0 ? 'adjustment_remove' : 'adjustment_add',
      quantity: -delta, // negative in stock terms for remove, positive for add
      reference_id: saleId,
      notes: `Edit sale ${saleId}: qty ${oldQuantity} → ${newQuantity}`,
      created_by: user.id,
    })
  }

  return Response.json({
    success: true,
    sale_id: saleId,
    old_quantity: oldQuantity,
    new_quantity: newQuantity,
    total_amount,
    commission_amount,
    new_stock: new_quantity_on_hand,
  })
}

// DELETE — remove a sale entirely and return its stock to inventory
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ saleId: string }> }
) {
  const { saleId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .select('id, store_id, product_id, quantity')
    .eq('id', saleId)
    .single()

  if (saleErr || !sale) {
    return Response.json({ error: 'Sale not found' }, { status: 404 })
  }

  if (profile.role === 'store_owner' && profile.store_id !== sale.store_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (profile.role !== 'store_owner' && profile.role !== 'ops_manager' && profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()

  // Fetch inventory row
  const { data: inv, error: invErr } = await supabase
    .from('store_inventory')
    .select('id, quantity_on_hand')
    .eq('store_id', sale.store_id)
    .eq('product_id', sale.product_id)
    .single()

  if (invErr || !inv) {
    return Response.json({ error: 'Inventory not found' }, { status: 404 })
  }

  // Return stock
  const new_quantity_on_hand = inv.quantity_on_hand + sale.quantity
  const { error: invUpdErr } = await adminClient
    .from('store_inventory')
    .update({ quantity_on_hand: new_quantity_on_hand, updated_at: new Date().toISOString() })
    .eq('id', inv.id)

  if (invUpdErr) {
    return Response.json({ error: 'Failed to return stock', details: invUpdErr.message }, { status: 500 })
  }

  // Log adjustment movement
  await adminClient.from('stock_movements').insert({
    store_id: sale.store_id,
    product_id: sale.product_id,
    movement_type: 'adjustment_add',
    quantity: sale.quantity,
    reference_id: saleId,
    notes: `Delete sale ${saleId}: returned ${sale.quantity} pairs to stock`,
    created_by: user.id,
  })

  // Delete the sale row — use admin client to bypass any RLS
  const { error: delErr } = await adminClient
    .from('sales')
    .delete()
    .eq('id', saleId)

  if (delErr) {
    return Response.json({ error: 'Failed to delete sale', details: delErr.message }, { status: 500 })
  }

  return Response.json({
    success: true,
    sale_id: saleId,
    returned_to_stock: sale.quantity,
    new_stock: new_quantity_on_hand,
  })
}
