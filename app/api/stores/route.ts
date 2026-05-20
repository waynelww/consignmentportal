import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

function randomChars(length: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

async function generateDoNumber(supabase: Awaited<ReturnType<typeof createClient>>) {
  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('delivery_orders')
    .select('*', { count: 'exact', head: true })
    .like('do_number', `DO-${year}-%`)
  const seq = (count || 0) + 1
  return `DO-${year}-${String(seq).padStart(4, '0')}`
}

const CreateStoreSchema = z.object({
  store_name: z.string().min(1),
  pic_name: z.string().min(1),
  pic_phone: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  postcode: z.string().min(1),
  store_type: z.enum([
    'barbershop', 'shoe_store', 'fashion_boutique', 'sports_store',
    'laundromat', 'gym', 'muslim_fashion', 'school_uniform',
    'pharmacy', 'optical', 'cafe', 'other',
  ]),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_account_name: z.string().optional(),
  commission_rate: z.number().min(0).max(100).default(30),
  notes: z.string().optional(),
  initial_inventory: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().nonnegative(),
    restock_threshold: z.number().int().nonnegative().default(5),
  })).optional().default([]),
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

  const parsed = CreateStoreSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const {
    store_name, pic_name, pic_phone, email, password,
    address, city, state, postcode, store_type,
    bank_name, bank_account_number, bank_account_name,
    commission_rate, notes, initial_inventory,
  } = parsed.data

  // Generate store_code: count existing stores + 1
  const { count: storeCount } = await supabase
    .from('stores')
    .select('*', { count: 'exact', head: true })

  const storeSeq = (storeCount || 0) + 1
  const storeCode = `STR-${String(storeSeq).padStart(3, '0')}`
  const qrCodeRef = `${storeCode}-${randomChars(8)}`

  // INSERT store
  const { data: newStore, error: storeErr } = await supabase
    .from('stores')
    .insert({
      store_code: storeCode,
      store_name,
      pic_name,
      pic_phone,
      email,
      address,
      city,
      state,
      postcode,
      store_type,
      bank_name: bank_name ?? null,
      bank_account_number: bank_account_number ?? null,
      bank_account_name: bank_account_name ?? null,
      commission_rate,
      status: 'active',
      qr_code_ref: qrCodeRef,
      notes: notes ?? null,
    })
    .select('id')
    .single()

  if (storeErr || !newStore) {
    return Response.json({ error: 'Failed to create store', details: storeErr?.message }, { status: 500 })
  }

  // Create Supabase auth user via service client
  const serviceClient = await createServiceClient()
  const { data: authUser, error: authErr } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authErr || !authUser.user) {
    // Rollback store
    await supabase.from('stores').delete().eq('id', newStore.id)
    return Response.json({ error: 'Failed to create auth user', details: authErr?.message }, { status: 500 })
  }

  // INSERT profile
  const { error: profileErr } = await serviceClient
    .from('profiles')
    .insert({
      id: authUser.user.id,
      full_name: pic_name,
      phone: pic_phone,
      role: 'store_owner',
      store_id: newStore.id,
    })

  if (profileErr) {
    return Response.json({ error: 'Failed to create profile', details: profileErr.message }, { status: 500 })
  }

  // INSERT initial inventory + delivery order
  if (initial_inventory.length > 0) {
    const inventoryRows = initial_inventory.map((item) => ({
      store_id: newStore.id,
      product_id: item.product_id,
      quantity_on_hand: item.quantity,
      restock_threshold: item.restock_threshold,
    }))

    const { error: invErr } = await supabase.from('store_inventory').insert(inventoryRows)
    if (invErr) {
      return Response.json({ error: 'Failed to insert inventory', details: invErr.message }, { status: 500 })
    }

    // Fetch product cost prices
    const productIds = initial_inventory.map((i) => i.product_id)
    const { data: products } = await supabase
      .from('products')
      .select('id, cost_price')
      .in('id', productIds)
    const costMap = new Map((products ?? []).map((p) => [p.id, p.cost_price]))

    // Generate DO number
    const doNumber = await generateDoNumber(supabase)
    const totalPairs = initial_inventory.reduce((sum, i) => sum + i.quantity, 0)

    const { data: deliveryOrder, error: doErr } = await supabase
      .from('delivery_orders')
      .insert({
        do_number: doNumber,
        store_id: newStore.id,
        restock_request_id: null,
        do_type: 'initial',
        status: 'acknowledged',
        total_pairs: totalPairs,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (doErr || !deliveryOrder) {
      return Response.json({ error: 'Failed to create initial DO', details: doErr?.message }, { status: 500 })
    }

    const doItems = initial_inventory.map((item) => ({
      delivery_order_id: deliveryOrder.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost: costMap.get(item.product_id) ?? 0,
    }))

    await supabase.from('delivery_order_items').insert(doItems)

    // INSERT stock movements
    const movements = initial_inventory.map((item) => ({
      store_id: newStore.id,
      product_id: item.product_id,
      movement_type: 'inbound_initial' as const,
      quantity: item.quantity,
      reference_id: deliveryOrder.id,
      notes: `Initial stock for new store ${storeCode}`,
      created_by: user.id,
    }))

    await supabase.from('stock_movements').insert(movements)
  }

  // Notify ops_manager
  await supabase.from('notifications').insert({
    recipient_role: 'ops_manager',
    recipient_store_id: null,
    type: 'new_store_added',
    title: 'New Store Added',
    message: `New store ${store_name} (${storeCode}) has been added`,
    reference_id: newStore.id,
    reference_type: 'store',
    is_read: false,
  })

  return Response.json({ success: true, store_id: newStore.id, store_code: storeCode })
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
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const search = searchParams.get('search')
  const state = searchParams.get('state')
  const store_type = searchParams.get('store_type')
  const status = searchParams.get('status')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '25', 10), 100)
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from('stores')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (search) {
    query = query.or(`store_name.ilike.%${search}%,store_code.ilike.%${search}%,pic_name.ilike.%${search}%`)
  }
  if (state) query = query.eq('state', state)
  if (store_type) query = query.eq('store_type', store_type)
  if (status) query = query.eq('status', status)

  const { data, count, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Fetch MTD sales counts for each store
  const now = new Date()
  const mtdStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const storeIds = (data ?? []).map((s) => s.id)
  let salesCounts: Record<string, number> = {}

  if (storeIds.length > 0) {
    const { data: salesData } = await supabase
      .from('sales')
      .select('store_id, quantity')
      .in('store_id', storeIds)
      .gte('sale_date', mtdStart)

    for (const s of salesData ?? []) {
      salesCounts[s.store_id] = (salesCounts[s.store_id] ?? 0) + s.quantity
    }
  }

  const stores = (data ?? []).map((store) => ({
    ...store,
    mtd_sales_pairs: salesCounts[store.id] ?? 0,
  }))

  return Response.json({
    stores,
    pagination: {
      total: count ?? 0,
      page,
      limit,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  })
}
