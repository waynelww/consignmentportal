import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const RestockRequestSchema = z.object({
  store_id: z.string().uuid(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity_requested: z.number().int().positive(),
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = RestockRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { store_id, items, notes } = parsed.data

  if (profile.role === 'store_owner' && profile.store_id !== store_id) {
    return Response.json({ error: 'Forbidden: cannot request restock for another store' }, { status: 403 })
  }
  if (profile.role !== 'store_owner' && profile.role !== 'ops_manager' && profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const totalQty = items.reduce((sum, item) => sum + item.quantity_requested, 0)
  if (totalQty < 12) {
    return Response.json({
      error: 'Minimum restock quantity is 12 pairs total',
      total_requested: totalQty,
    }, { status: 400 })
  }

  const { data: restockRequest, error: reqErr } = await supabase
    .from('restock_requests')
    .insert({
      store_id,
      status: 'pending',
      requested_by: user.id,
      notes: notes ?? null,
    })
    .select('id')
    .single()

  if (reqErr || !restockRequest) {
    return Response.json({ error: 'Failed to create restock request', details: reqErr?.message }, { status: 500 })
  }

  const requestItems = items.map((item) => ({
    restock_request_id: restockRequest.id,
    product_id: item.product_id,
    quantity_requested: item.quantity_requested,
    quantity_approved: null,
  }))

  const { error: itemsErr } = await supabase
    .from('restock_request_items')
    .insert(requestItems)

  if (itemsErr) {
    return Response.json({ error: 'Failed to insert request items', details: itemsErr.message }, { status: 500 })
  }

  await supabase.from('notifications').insert({
    recipient_role: 'ops_manager',
    recipient_store_id: null,
    type: 'restock_request',
    title: 'New Restock Request',
    message: `Store ${store_id} has submitted a restock request for ${totalQty} pairs`,
    reference_id: restockRequest.id,
    reference_type: 'restock_request',
    is_read: false,
  })

  return Response.json({ success: true, request_id: restockRequest.id })
}
