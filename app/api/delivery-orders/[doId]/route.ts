import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Statuses that block edit/cancel — once the store has acknowledged receipt,
// inventory has been added and the DO is locked.
const LOCKED_STATUSES = new Set(['acknowledged'])

const UpdateSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1)
    .optional(),
  notes: z.string().nullable().optional(),
  courier: z.string().nullable().optional(),
  tracking_number: z.string().nullable().optional(),
  dispatch_date: z.string().nullable().optional(),
})

async function ensureAdminAndUnlocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  doId: string
) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return { error: 'Forbidden: admin only', status: 403 as const }
  }

  const { data: doRow, error: doErr } = await supabase
    .from('delivery_orders')
    .select('id, status, store_id')
    .eq('id', doId)
    .single()

  if (doErr || !doRow) return { error: 'DO not found', status: 404 as const }

  if (LOCKED_STATUSES.has(doRow.status)) {
    return {
      error: `Cannot modify a ${doRow.status} delivery order — stock already added to store inventory.`,
      status: 409 as const,
    }
  }

  return { user, doRow }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ doId: string }> }
) {
  const { doId } = await params
  const supabase = await createClient()

  const check = await ensureAdminAndUnlocked(supabase, doId)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation', details: parsed.error.flatten() }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Update DO metadata fields if present
  const metaPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('notes' in parsed.data) metaPatch.notes = parsed.data.notes
  if ('courier' in parsed.data) metaPatch.courier = parsed.data.courier
  if ('tracking_number' in parsed.data) metaPatch.tracking_number = parsed.data.tracking_number
  if ('dispatch_date' in parsed.data) metaPatch.dispatch_date = parsed.data.dispatch_date

  // If items provided: replace all items + recompute total_pairs + fetch fresh unit_costs
  if (parsed.data.items) {
    const items = parsed.data.items

    // Pull cost_price for each product (delivery_order_items.unit_cost is NOT NULL)
    const productIds = items.map((i) => i.product_id)
    const { data: products, error: prodErr } = await adminClient
      .from('products')
      .select('id, cost_price')
      .in('id', productIds)

    if (prodErr || !products) {
      return Response.json({ error: 'Failed to fetch product costs' }, { status: 500 })
    }
    const costMap = Object.fromEntries(products.map((p) => [p.id, p.cost_price]))

    // Validate every product is found
    for (const item of items) {
      if (costMap[item.product_id] == null) {
        return Response.json({ error: `Product ${item.product_id} not found` }, { status: 404 })
      }
    }

    // Replace items: delete then insert (simpler + atomic enough for ops use)
    const { error: delErr } = await adminClient
      .from('delivery_order_items')
      .delete()
      .eq('delivery_order_id', doId)

    if (delErr) {
      return Response.json({ error: 'Failed to clear existing items', details: delErr.message }, { status: 500 })
    }

    const newRows = items.map((item) => ({
      delivery_order_id: doId,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost: costMap[item.product_id],
    }))

    const { error: insErr } = await adminClient
      .from('delivery_order_items')
      .insert(newRows)

    if (insErr) {
      return Response.json({ error: 'Failed to insert items', details: insErr.message }, { status: 500 })
    }

    metaPatch.total_pairs = items.reduce((s, i) => s + i.quantity, 0)
  }

  const { data: updated, error: metaErr } = await adminClient
    .from('delivery_orders')
    .update(metaPatch)
    .eq('id', doId)
    .select()
    .single()

  if (metaErr) {
    return Response.json({ error: 'Failed to update DO', details: metaErr.message }, { status: 500 })
  }

  return Response.json({ success: true, delivery_order: updated })
}

// DELETE = cancel. We hard-delete since no inventory was deducted/added yet
// (acknowledged DOs are blocked above).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ doId: string }> }
) {
  const { doId } = await params
  const supabase = await createClient()

  const check = await ensureAdminAndUnlocked(supabase, doId)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const adminClient = createAdminClient()

  // Delete items first (FK), then the DO row
  const { error: itemsErr } = await adminClient
    .from('delivery_order_items')
    .delete()
    .eq('delivery_order_id', doId)

  if (itemsErr) {
    return Response.json({ error: 'Failed to delete items', details: itemsErr.message }, { status: 500 })
  }

  const { error: doErr } = await adminClient
    .from('delivery_orders')
    .delete()
    .eq('id', doId)

  if (doErr) {
    return Response.json({ error: 'Failed to delete DO', details: doErr.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
