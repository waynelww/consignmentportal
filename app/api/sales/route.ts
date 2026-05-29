import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function calcCommission(totalAmount: number, commissionRate: number) {
  const commission = Number((totalAmount * commissionRate / 100).toFixed(2))
  return { commission_amount: commission, xocks_revenue: Number((totalAmount - commission).toFixed(2)) }
}

const RecordSaleSchema = z.object({
  store_id: z.string().uuid(),
  product_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  payment_method: z.enum(['qr', 'cash']),
  qr_reference: z.string().optional(),
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

  const parsed = RecordSaleSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { store_id, product_id, quantity, payment_method, qr_reference } = parsed.data

  // store_owner can only record for own store
  if (profile.role === 'store_owner' && profile.store_id !== store_id) {
    return Response.json({ error: 'Forbidden: cannot record sales for another store' }, { status: 403 })
  }
  if (profile.role !== 'store_owner' && profile.role !== 'ops_manager' && profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch inventory
  const { data: inventory, error: invErr } = await supabase
    .from('store_inventory')
    .select('id, quantity_on_hand, restock_threshold')
    .eq('store_id', store_id)
    .eq('product_id', product_id)
    .single()

  if (invErr || !inventory) {
    return Response.json({ error: 'Product not found in store inventory' }, { status: 404 })
  }

  if (inventory.quantity_on_hand < quantity) {
    return Response.json({
      error: 'Insufficient stock',
      available: inventory.quantity_on_hand,
    }, { status: 400 })
  }

  // Fetch store commission rate — use admin client to bypass RLS on stores table
  const adminClient = createAdminClient()
  const { data: store, error: storeErr } = await adminClient
    .from('stores')
    .select('commission_rate, recipient_store_id')
    .eq('id', store_id)
    .single()

  if (storeErr || !store) {
    return Response.json({ error: 'Store not found' }, { status: 404 })
  }

  // Fetch product price
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('selling_price')
    .eq('id', product_id)
    .single()

  if (prodErr || !product) {
    return Response.json({ error: 'Product not found' }, { status: 404 })
  }

  const unit_price = product.selling_price
  const total_amount = Number((quantity * unit_price).toFixed(2))
  const { commission_amount, xocks_revenue } = calcCommission(total_amount, store.commission_rate)

  // INSERT sale
  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .insert({
      store_id,
      product_id,
      quantity,
      unit_price,
      total_amount,
      commission_amount,
      xocks_revenue,
      payment_method,
      qr_reference: qr_reference ?? null,
      recorded_by: user.id,
      sale_date: new Date().toISOString().split('T')[0],
    })
    .select('id')
    .single()

  if (saleErr || !sale) {
    return Response.json({ error: 'Failed to record sale', details: saleErr?.message }, { status: 500 })
  }

  const new_quantity_on_hand = inventory.quantity_on_hand - quantity

  // UPDATE inventory
  const { error: updateInvErr } = await supabase
    .from('store_inventory')
    .update({ quantity_on_hand: new_quantity_on_hand, updated_at: new Date().toISOString() })
    .eq('id', inventory.id)

  if (updateInvErr) {
    return Response.json({ error: 'Failed to update inventory', details: updateInvErr.message }, { status: 500 })
  }

  // INSERT stock movement
  await supabase.from('stock_movements').insert({
    store_id,
    product_id,
    movement_type: 'outbound_sale',
    quantity: -quantity,
    reference_id: sale.id,
    notes: `Sale ${sale.id}`,
    created_by: user.id,
  })

  // Check restock threshold
  if (new_quantity_on_hand <= inventory.restock_threshold) {
    // Check for existing pending restock_alert
    const { data: existingAlert } = await supabase
      .from('restock_alerts')
      .select('id')
      .eq('store_id', store_id)
      .eq('product_id', product_id)
      .eq('status', 'pending')
      .maybeSingle()

    if (!existingAlert) {
      const { data: newAlert } = await supabase
        .from('restock_alerts')
        .insert({
          store_id,
          product_id,
          current_quantity: new_quantity_on_hand,
          threshold_quantity: inventory.restock_threshold,
          status: 'pending',
        })
        .select('id')
        .single()

      if (newAlert) {
        // Notify ops_manager role
        await supabase.from('notifications').insert({
          recipient_role: 'ops_manager',
          recipient_store_id: null,
          type: 'low_stock_alert',
          title: 'Low Stock Alert',
          message: `Store ${store_id} has low stock for product ${product_id} (${new_quantity_on_hand} remaining)`,
          reference_id: newAlert.id,
          reference_type: 'restock_alert',
          is_read: false,
        })

        // Notify the store itself
        if (store.recipient_store_id) {
          await supabase.from('notifications').insert({
            recipient_role: null,
            recipient_store_id: store.recipient_store_id,
            type: 'low_stock_alert',
            title: 'Low Stock Alert',
            message: `Your store has low stock for product ${product_id} (${new_quantity_on_hand} remaining)`,
            reference_id: newAlert.id,
            reference_type: 'restock_alert',
            is_read: false,
          })
        } else {
          await supabase.from('notifications').insert({
            recipient_role: null,
            recipient_store_id: store_id,
            type: 'low_stock_alert',
            title: 'Low Stock Alert',
            message: `Your store has low stock for product ${product_id} (${new_quantity_on_hand} remaining)`,
            reference_id: newAlert.id,
            reference_type: 'restock_alert',
            is_read: false,
          })
        }
      }
    }
  }

  return Response.json({
    success: true,
    sale_id: sale.id,
    total_amount,
    commission_amount,
    new_quantity: new_quantity_on_hand,
  })
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  const { searchParams } = request.nextUrl
  const store_id = searchParams.get('store_id')
  const start_date = searchParams.get('start_date')
  const end_date = searchParams.get('end_date')
  const product_id = searchParams.get('product_id')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  // store_owner can only query own store
  if (profile.role === 'store_owner') {
    const effectiveStoreId = store_id ?? profile.store_id
    if (effectiveStoreId !== profile.store_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let query = supabase
    .from('sales')
    .select(`
      *,
      products:product_id ( name, sku ),
      stores:store_id ( store_name, store_code )
    `)
    .order('created_at', { ascending: false })
    .limit(limit)

  const effectiveStoreId = profile.role === 'store_owner' ? profile.store_id : store_id
  if (effectiveStoreId) query = query.eq('store_id', effectiveStoreId)
  if (product_id) query = query.eq('product_id', product_id)
  if (start_date) query = query.gte('sale_date', start_date)
  if (end_date) query = query.lte('sale_date', end_date)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ sales: data })
}
