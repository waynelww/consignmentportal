import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { adjustWarehouseStock } from '@/lib/inventory/adjust-warehouse-stock'

const CheckoutSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const parsed = CheckoutSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = await createServiceClient()

  const { data: event } = await svc.from('events').select('id, name, status').eq('id', eventId).single()
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (event.status !== 'active') return Response.json({ error: 'Event is closed — cannot check out more stock' }, { status: 400 })

  const failures: string[] = []

  for (const item of parsed.data.items) {
    const result = await adjustWarehouseStock({
      productId: item.product_id,
      delta: -item.quantity,
      reason: `Event checkout: ${event.name}`,
      referenceType: 'event_checkout',
      referenceId: eventId,
      createdBy: user.id,
    })
    if ('error' in result) { failures.push(`${item.product_id}: ${result.error}`); continue }

    const { data: existingItem } = await svc
      .from('event_stock_items')
      .select('id, quantity_taken')
      .eq('event_id', eventId)
      .eq('product_id', item.product_id)
      .maybeSingle()

    if (existingItem) {
      await svc.from('event_stock_items')
        .update({ quantity_taken: existingItem.quantity_taken + item.quantity, updated_at: new Date().toISOString() })
        .eq('id', existingItem.id)
    } else {
      await svc.from('event_stock_items').insert({
        event_id: eventId,
        product_id: item.product_id,
        quantity_taken: item.quantity,
      })
    }
  }

  if (failures.length > 0) {
    return Response.json({ error: 'Some items failed to check out', details: failures }, { status: 500 })
  }

  return Response.json({ success: true })
}
