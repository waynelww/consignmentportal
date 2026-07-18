import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { adjustWarehouseStock } from '@/lib/inventory/adjust-warehouse-stock'

const CloseSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity_sold: z.number().int().min(0),
    quantity_returned: z.number().int().min(0),
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

  const parsed = CloseSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = await createServiceClient()

  const { data: event } = await svc.from('events').select('id, name, status').eq('id', eventId).single()
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (event.status !== 'active') return Response.json({ error: 'Event is already closed' }, { status: 400 })

  const failures: string[] = []
  const results: Array<{ product_id: string; variance: number }> = []

  for (const item of parsed.data.items) {
    const { data: existingItem } = await svc
      .from('event_stock_items')
      .select('id, quantity_taken')
      .eq('event_id', eventId)
      .eq('product_id', item.product_id)
      .maybeSingle()

    if (!existingItem) { failures.push(`${item.product_id}: was never checked out to this event`); continue }

    const expectedRemaining = existingItem.quantity_taken - item.quantity_sold
    const variance = item.quantity_returned - expectedRemaining

    if (item.quantity_returned > 0) {
      const result = await adjustWarehouseStock({
        productId: item.product_id,
        delta: item.quantity_returned,
        reason: `Event return: ${event.name}`,
        referenceType: 'event_return',
        referenceId: eventId,
        createdBy: user.id,
      })
      if ('error' in result) { failures.push(`${item.product_id}: ${result.error}`); continue }
    }

    await svc.from('event_stock_items').update({
      quantity_sold_shopify: item.quantity_sold,
      quantity_returned: item.quantity_returned,
      variance,
      updated_at: new Date().toISOString(),
    }).eq('id', existingItem.id)

    results.push({ product_id: item.product_id, variance })
  }

  if (failures.length > 0) {
    return Response.json({ error: 'Some items failed to close out', details: failures }, { status: 500 })
  }

  await svc.from('events').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', eventId)

  const totalVariance = results.reduce((s, r) => s + r.variance, 0)
  return Response.json({ success: true, results, tallies: totalVariance === 0 && results.every((r) => r.variance === 0) })
}
