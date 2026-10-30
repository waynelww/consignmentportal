import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { insertWithSequenceCode } from '@/lib/sequence-code'
import { clean } from '@/lib/onboarding/schemas'
import { stepLabel } from '@/lib/onboarding/steps'

function randomChars(length: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
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
  // Store types are managed dynamically in the store_types table.
  store_type: z.string().min(1),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_account_name: z.string().optional(),
  commission_rate: z.number().min(0).max(100).default(30),
  pairs_per_code: z.number().int().min(1).max(999).default(3),
  payment_terms_days: z.number().int().min(1).max(365).optional().default(7),
  notes: z.string().optional(),
  // Who at Xocks opened the store. Required for new stores (the shared admin
  // login can't tell us); must be an active Xocks team member (checked below).
  opened_by_member_id: z.string().uuid('Choose who opened this store'),
  initial_inventory: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().nonnegative(),
  })).optional().default([]),
  // Optional shipment details (blank = not set). Shown on DOs and packing slips when filled.
  shipment_address: z.string().optional(),
  shipment_contact: z.string().optional(),
  shipment_pic: z.string().optional(),
  // Quick create from an onboarding card: the card must be at "Details received"
  // and not yet linked. Its shipment details are copied from the card, and on
  // success the card is linked to this store and moved to "Account created".
  onboarding_card_id: z.string().uuid().optional(),
  onboarding_moved_by_member_id: z.string().uuid().optional(),
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
    commission_rate, payment_terms_days, notes, initial_inventory, opened_by_member_id, pairs_per_code,
    onboarding_card_id, onboarding_moved_by_member_id,
  } = parsed.data

  const { data: opener } = await supabase
    .from('xocks_team_members')
    .select('id')
    .eq('id', opened_by_member_id)
    .eq('active', true)
    .maybeSingle()
  if (!opener) {
    return Response.json({ error: 'Choose an active Xocks team member for "Opened by"' }, { status: 400 })
  }

  // Quick create: check the onboarding card before anything is written.
  const admin = createAdminClient()
  let card: { id: string; step: string; store_id: string | null; shipment_address: string | null; shipment_contact: string | null; shipment_pic: string | null } | null = null
  if (onboarding_card_id) {
    if (!onboarding_moved_by_member_id) {
      return Response.json({ error: 'Choose who you are for the onboarding card' }, { status: 400 })
    }
    const { data: moverOk } = await admin
      .from('xocks_team_members').select('id').eq('id', onboarding_moved_by_member_id).eq('active', true).maybeSingle()
    if (!moverOk) {
      return Response.json({ error: 'Choose an active Xocks team member for the onboarding card' }, { status: 400 })
    }
    const { data: found } = await admin
      .from('onboarding_cards')
      .select('id, step, store_id, shipment_address, shipment_contact, shipment_pic')
      .eq('id', onboarding_card_id)
      .maybeSingle()
    if (!found) return Response.json({ error: 'Onboarding card not found' }, { status: 404 })
    if (found.store_id || found.step !== 'details_received') {
      return Response.json(
        { error: 'This onboarding card is not waiting for a store (it must be at Details received and not linked yet)' },
        { status: 409 },
      )
    }
    card = found
  }

  // A card's shipment details are copied from the card, not taken from the form.
  const shipment = card
    ? { address: card.shipment_address, contact: card.shipment_contact, pic: card.shipment_pic }
    : { address: clean(parsed.data.shipment_address), contact: clean(parsed.data.shipment_contact), pic: clean(parsed.data.shipment_pic) }

  // INSERT store — store_code generated from the max existing code, not a
  // count, so it can't collide with a code still in use after a deletion.
  const { data: newStore, error: storeErr, code: storeCode } = await insertWithSequenceCode<{ id: string }>({
    supabase,
    table: 'stores',
    column: 'store_code',
    prefix: 'STR-',
    padLength: 3,
    insertFn: (storeCode) =>
      supabase
        .from('stores')
        .insert({
          store_code: storeCode,
          store_name,
          pic_name,
          pic_phone,
          email,
          pairs_per_code,
          address,
          city,
          state,
          postcode,
          store_type,
          bank_name: bank_name ?? null,
          bank_account_number: bank_account_number ?? null,
          bank_account_name: bank_account_name ?? null,
          commission_rate,
          payment_terms_days: payment_terms_days ?? 7,
          status: 'active',
          qr_code_ref: `${storeCode}-${randomChars(8)}`,
          notes: notes ?? null,
          opened_by_member_id,
          shipment_address: shipment.address,
          shipment_contact: shipment.contact,
          shipment_pic: shipment.pic,
        })
        .select('id')
        .single(),
  })

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

  // Quick create: link the card to the new store and move it to Account created.
  // The condition re-checks the card, so a card changed meanwhile is not overwritten.
  if (card && onboarding_moved_by_member_id) {
    const now = new Date().toISOString()
    const { data: linkedCard, error: linkErr } = await admin
      .from('onboarding_cards')
      .update({
        store_id: newStore.id,
        step: 'account_created',
        step_changed_at: now,
        updated_by_member_id: onboarding_moved_by_member_id,
        updated_at: now,
      })
      .eq('id', card.id)
      .eq('step', 'details_received')
      .is('store_id', null)
      .select('id')
      .maybeSingle()
    if (linkErr || !linkedCard) {
      return Response.json({
        error: 'Store created, but the onboarding card could not be linked. Link it from the Onboarding tab.',
        store_id: newStore.id,
        details: linkErr?.message,
      }, { status: 500 })
    }
    const { error: historyErr } = await admin.from('onboarding_card_history').insert({
      card_id: card.id,
      from_step: 'details_received',
      to_step: 'account_created',
      moved_by_member_id: onboarding_moved_by_member_id,
    })
    if (historyErr) {
      return Response.json({
        error: `Store created and linked, but the ${stepLabel('account_created')} history row failed`,
        store_id: newStore.id,
        details: historyErr.message,
      }, { status: 500 })
    }
  }

  // INSERT initial inventory + delivery order
  if (initial_inventory.length > 0) {
    const inventoryRows = initial_inventory.map((item) => ({
      store_id: newStore.id,
      product_id: item.product_id,
      quantity_on_hand: item.quantity,
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

    const totalPairs = initial_inventory.reduce((sum, i) => sum + i.quantity, 0)
    const year = new Date().getFullYear()

    const { data: deliveryOrder, error: doErr } = await insertWithSequenceCode<{ id: string }>({
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
            store_id: newStore.id,
            restock_request_id: null,
            do_type: 'initial',
            status: 'acknowledged',
            total_pairs: totalPairs,
            created_by: user.id,
          })
          .select('id')
          .single(),
    })

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
