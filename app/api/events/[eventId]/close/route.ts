import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { transferStock, getLocationIdByType } from '@/lib/inventory/transfer-stock'

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

  const { data: event } = await svc.from('events').select('id, name, status, stock_location_id').eq('id', eventId).single()
  if (!event || !event.stock_location_id) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (event.status !== 'active') return Response.json({ error: 'Event is already closed' }, { status: 400 })

  const officeId = await getLocationIdByType('office')
  if (!officeId) return Response.json({ error: 'Office location is not configured' }, { status: 500 })

  // "Taken" per product, read fresh from the ledger, to compute variance.
  const { data: transfers } = await svc
    .from('stock_transfers')
    .select('product_id, quantity, to_location_id')
    .eq('to_location_id', event.stock_location_id)

  const takenByProduct: Record<string, number> = {}
  for (const t of transfers ?? []) takenByProduct[t.product_id] = (takenByProduct[t.product_id] ?? 0) + t.quantity

  const failures: string[] = []
  const results: Array<{ product_id: string; variance: number }> = []

  for (const item of parsed.data.items) {
    const taken = takenByProduct[item.product_id] ?? 0
    if (taken === 0) { failures.push(`${item.product_id}: was never checked out to this event`); continue }

    if (item.quantity_sold > 0) {
      const soldResult = await transferStock({
        productId: item.product_id,
        quantity: item.quantity_sold,
        fromLocationId: event.stock_location_id,
        toLocationId: null,
        reason: `Sold at event (Shopify): ${event.name}`,
        createdBy: user.id,
      })
      if ('error' in soldResult) { failures.push(`${item.product_id}: ${soldResult.error}`); continue }
    }

    if (item.quantity_returned > 0) {
      const returnResult = await transferStock({
        productId: item.product_id,
        quantity: item.quantity_returned,
        fromLocationId: event.stock_location_id,
        toLocationId: officeId,
        reason: `Event return: ${event.name}`,
        createdBy: user.id,
      })
      if ('error' in returnResult) { failures.push(`${item.product_id}: ${returnResult.error}`); continue }
    }

    const variance = item.quantity_returned - (taken - item.quantity_sold)
    results.push({ product_id: item.product_id, variance })
  }

  if (failures.length > 0) {
    return Response.json({ error: 'Some items failed to close out', details: failures }, { status: 500 })
  }

  await svc.from('events').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', eventId)

  return Response.json({ success: true, results, tallies: results.every((r) => r.variance === 0) })
}
