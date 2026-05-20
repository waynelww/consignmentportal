import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

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

  if (!store_id) {
    return Response.json({ error: 'store_id is required' }, { status: 400 })
  }

  if (profile.role === 'store_owner' && profile.store_id !== store_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('store_inventory')
    .select(`
      *,
      products:product_id ( id, sku, name, category, color, selling_price, is_active )
    `)
    .eq('store_id', store_id)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const inventory = (data ?? []).map((item) => {
    let status: 'in_stock' | 'low_stock' | 'out_of_stock'
    if (item.quantity_on_hand <= 0) {
      status = 'out_of_stock'
    } else if (item.quantity_on_hand <= item.restock_threshold) {
      status = 'low_stock'
    } else {
      status = 'in_stock'
    }
    return { ...item, status }
  })

  return Response.json({ inventory })
}

const AdjustmentSchema = z.object({
  store_id: z.string().uuid(),
  product_id: z.string().uuid(),
  quantity_change: z.number().int().positive(),
  movement_type: z.enum(['adjustment_add', 'adjustment_remove']),
  notes: z.string().optional(),
})

export async function PATCH(request: NextRequest) {
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

  const parsed = AdjustmentSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { store_id, product_id, quantity_change, movement_type, notes } = parsed.data

  const { data: inventory, error: invErr } = await supabase
    .from('store_inventory')
    .select('id, quantity_on_hand')
    .eq('store_id', store_id)
    .eq('product_id', product_id)
    .single()

  if (invErr || !inventory) {
    return Response.json({ error: 'Inventory record not found' }, { status: 404 })
  }

  const delta = movement_type === 'adjustment_add' ? quantity_change : -quantity_change
  const new_quantity = inventory.quantity_on_hand + delta

  if (new_quantity < 0) {
    return Response.json({ error: 'Adjustment would result in negative inventory' }, { status: 400 })
  }

  const { data: updated, error: updateErr } = await supabase
    .from('store_inventory')
    .update({ quantity_on_hand: new_quantity, updated_at: new Date().toISOString() })
    .eq('id', inventory.id)
    .select()
    .single()

  if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 })

  await supabase.from('stock_movements').insert({
    store_id,
    product_id,
    movement_type,
    quantity: delta,
    reference_id: null,
    notes: notes ?? null,
    created_by: user.id,
  })

  return Response.json({ inventory: updated })
}
