import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function calcCommission(totalAmount: number, commissionRate: number) {
  const commission = Number((totalAmount * commissionRate / 100).toFixed(2))
  return { commission_amount: commission, xocks_revenue: Number((totalAmount - commission).toFixed(2)) }
}

const BatchSaleSchema = z.object({
  store_id: z.string().uuid(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
})

export async function POST(request: NextRequest) {
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

  const parsed = BatchSaleSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { store_id, items } = parsed.data

  if (profile.role === 'store_owner' && profile.store_id !== store_id) {
    return Response.json({ error: 'Forbidden: cannot record sales for another store' }, { status: 403 })
  }
  if (profile.role !== 'store_owner' && profile.role !== 'ops_manager' && profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()

  // Fetch store commission rate
  const { data: store, error: storeErr } = await adminClient
    .from('stores')
    .select('commission_rate')
    .eq('id', store_id)
    .single()

  if (storeErr || !store) {
    return Response.json({ error: 'Store not found' }, { status: 404 })
  }

  const product_ids = items.map((i) => i.product_id)

  // Fetch all inventory rows in one query
  const { data: inventoryRows, error: invErr } = await supabase
    .from('store_inventory')
    .select('id, product_id, quantity_on_hand, restock_threshold')
    .eq('store_id', store_id)
    .in('product_id', product_ids)

  if (invErr || !inventoryRows) {
    return Response.json({ error: 'Failed to fetch inventory' }, { status: 500 })
  }

  // Fetch all product prices in one query
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, selling_price')
    .in('id', product_ids)

  if (prodErr || !products) {
    return Response.json({ error: 'Failed to fetch products' }, { status: 500 })
  }

  const invMap = Object.fromEntries(inventoryRows.map((r) => [r.product_id, r]))
  const prodMap = Object.fromEntries(products.map((p) => [p.id, p]))

  // Validate stock for all items upfront
  for (const item of items) {
    const inv = invMap[item.product_id]
    if (!inv) return Response.json({ error: `Product ${item.product_id} not found in inventory` }, { status: 404 })
    if (inv.quantity_on_hand < item.quantity) {
      return Response.json({
        error: `Insufficient stock for product ${item.product_id}`,
        available: inv.quantity_on_hand,
        requested: item.quantity,
      }, { status: 400 })
    }
  }

  const today = new Date().toISOString().split('T')[0]
  const results = []

  for (const item of items) {
    const inv = invMap[item.product_id]
    const prod = prodMap[item.product_id]
    if (!prod) return Response.json({ error: `Product price not found for ${item.product_id}` }, { status: 404 })

    const unit_price = prod.selling_price
    const total_amount = Number((item.quantity * unit_price).toFixed(2))
    const { commission_amount, xocks_revenue } = calcCommission(total_amount, store.commission_rate)

    // INSERT sale
    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .insert({
        store_id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price,
        total_amount,
        commission_amount,
        xocks_revenue,
        payment_method: 'cash',
        qr_reference: null,
        recorded_by: user.id,
        sale_date: today,
      })
      .select('id')
      .single()

    if (saleErr || !sale) {
      return Response.json({ error: 'Failed to record sale', details: saleErr?.message }, { status: 500 })
    }

    const new_quantity_on_hand = inv.quantity_on_hand - item.quantity

    // UPDATE inventory via adminClient
    const { error: updateInvErr } = await adminClient
      .from('store_inventory')
      .update({ quantity_on_hand: new_quantity_on_hand, updated_at: new Date().toISOString() })
      .eq('id', inv.id)

    if (updateInvErr) {
      return Response.json({ error: 'Failed to update inventory', details: updateInvErr.message }, { status: 500 })
    }

    // INSERT stock movement
    await adminClient.from('stock_movements').insert({
      store_id,
      product_id: item.product_id,
      movement_type: 'outbound_sale',
      quantity: -item.quantity,
      reference_id: sale.id,
      notes: `Batch sale ${sale.id}`,
      created_by: user.id,
    })

    // Check restock threshold
    if (new_quantity_on_hand <= inv.restock_threshold) {
      const { data: existingAlert } = await supabase
        .from('restock_alerts')
        .select('id')
        .eq('store_id', store_id)
        .eq('product_id', item.product_id)
        .eq('status', 'pending')
        .maybeSingle()

      if (!existingAlert) {
        const { data: newAlert } = await supabase
          .from('restock_alerts')
          .insert({
            store_id,
            product_id: item.product_id,
            current_quantity: new_quantity_on_hand,
            threshold_quantity: inv.restock_threshold,
            status: 'pending',
          })
          .select('id')
          .single()

        if (newAlert) {
          await supabase.from('notifications').insert([
            {
              recipient_role: 'ops_manager',
              recipient_store_id: null,
              type: 'low_stock_alert',
              title: 'Low Stock Alert',
              message: `Store ${store_id} has low stock for product ${item.product_id} (${new_quantity_on_hand} remaining)`,
              reference_id: newAlert.id,
              reference_type: 'restock_alert',
              is_read: false,
            },
            {
              recipient_role: null,
              recipient_store_id: store_id,
              type: 'low_stock_alert',
              title: 'Low Stock Alert',
              message: `Your store has low stock for product ${item.product_id} (${new_quantity_on_hand} remaining)`,
              reference_id: newAlert.id,
              reference_type: 'restock_alert',
              is_read: false,
            },
          ])
        }
      }
    }

    // Update in-memory map for subsequent items (same product added twice)
    invMap[item.product_id] = { ...inv, quantity_on_hand: new_quantity_on_hand }

    results.push({
      sale_id: sale.id,
      product_id: item.product_id,
      quantity: item.quantity,
      total_amount,
      commission_amount,
      new_quantity: new_quantity_on_hand,
    })
  }

  const grand_total = results.reduce((s, r) => s + r.total_amount, 0)
  const total_pairs = results.reduce((s, r) => s + r.quantity, 0)

  return Response.json({ success: true, results, grand_total, total_pairs })
}
