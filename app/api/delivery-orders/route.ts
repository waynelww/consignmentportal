import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

async function generateDoNumber(supabase: Awaited<ReturnType<typeof createClient>>) {
  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('delivery_orders')
    .select('*', { count: 'exact', head: true })
    .like('do_number', `DO-${year}-%`)
  const seq = (count || 0) + 1
  return `DO-${year}-${String(seq).padStart(4, '0')}`
}

const CreateDoSchema = z.object({
  store_id: z.string().uuid(),
  restock_request_id: z.string().uuid().optional(),
  do_type: z.enum(['initial', 'restock', 'return']),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
  notes: z.string().optional(),
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
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateDoSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { store_id, restock_request_id, do_type, items, notes } = parsed.data

  const doNumber = await generateDoNumber(supabase)
  const total_pairs = items.reduce((sum, i) => sum + i.quantity, 0)

  // Flow: Create → 'confirmed' (admin still fills courier/tracking on Dispatch).
  // Dispatch then jumps to 'delivered' (Waiting to Receive) in one step.
  const { data: deliveryOrder, error: doErr } = await supabase
    .from('delivery_orders')
    .insert({
      do_number: doNumber,
      store_id,
      restock_request_id: restock_request_id ?? null,
      do_type,
      status: 'confirmed',
      total_pairs,
      notes: notes ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (doErr || !deliveryOrder) {
    return Response.json({ error: 'Failed to create delivery order', details: doErr?.message }, { status: 500 })
  }

  // Fetch product cost prices for items
  const productIds = items.map((i) => i.product_id)
  const { data: products } = await supabase
    .from('products')
    .select('id, cost_price')
    .in('id', productIds)

  const costMap = new Map((products ?? []).map((p) => [p.id, p.cost_price]))

  const doItems = items.map((item) => ({
    delivery_order_id: deliveryOrder.id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_cost: costMap.get(item.product_id) ?? 0,
  }))

  const { error: itemsErr } = await supabase.from('delivery_order_items').insert(doItems)
  if (itemsErr) {
    return Response.json({ error: 'Failed to insert DO items', details: itemsErr.message }, { status: 500 })
  }

  return Response.json({ success: true, delivery_order_id: deliveryOrder.id, do_number: doNumber })
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
  const status = searchParams.get('status')
  const start_date = searchParams.get('start_date')
  const end_date = searchParams.get('end_date')

  if (profile.role === 'store_owner') {
    const effectiveStoreId = store_id ?? profile.store_id
    if (effectiveStoreId !== profile.store_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let query = supabase
    .from('delivery_orders')
    .select(`
      *,
      stores:store_id ( store_name, store_code )
    `)
    .order('created_at', { ascending: false })

  const effectiveStoreId = profile.role === 'store_owner' ? profile.store_id : store_id
  if (effectiveStoreId) query = query.eq('store_id', effectiveStoreId)
  if (status) query = query.eq('status', status)
  if (start_date) query = query.gte('created_at', start_date)
  if (end_date) query = query.lte('created_at', end_date + 'T23:59:59')

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ delivery_orders: data })
}
