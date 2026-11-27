import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { transferStock } from '@/lib/inventory/transfer-stock'
import { reasons } from '@/lib/events/stock-ledger'
import { isPatchSku } from '@/lib/pos/catalog'

const MoveSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
})

/**
 * Add stock into, or remove stock from, an event's own stock location.
 * Office is never involved: adding creates event stock (from = NULL),
 * removing takes it out of the system (to = NULL). Removing cannot go below
 * 0 — transferStock checks the event location has enough first.
 * Returns `done` (product ids applied) so the page can drop those lines and
 * a retry never applies them twice.
 */
export async function moveEventStock(
  request: NextRequest,
  eventId: string,
  mode: 'add' | 'remove',
): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const parsed = MoveSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  // Merge repeated SKUs so a pasted list with duplicates is one ledger row each.
  const qtyByProduct = new Map<string, number>()
  for (const i of parsed.data.items) qtyByProduct.set(i.product_id, (qtyByProduct.get(i.product_id) ?? 0) + i.quantity)

  const svc = await createServiceClient()

  const { data: event } = await svc.from('events').select('id, name, status, stock_location_id').eq('id', eventId).single()
  if (!event || !event.stock_location_id) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (event.status !== 'active') return Response.json({ error: 'Event is closed — stock can no longer be changed' }, { status: 400 })

  const { data: products } = await svc.from('products').select('id, sku').in('id', [...qtyByProduct.keys()])
  const skuOf = new Map((products ?? []).map((p) => [p.id as string, p.sku as string]))

  const done: string[] = []
  const failures: string[] = []

  for (const [productId, quantity] of qtyByProduct) {
    // Patches have no event stock (too many to count): never added or removed.
    if (isPatchSku(skuOf.get(productId))) {
      failures.push(`${skuOf.get(productId)}: patches have no event stock, they are always on the POS`)
      continue
    }
    const result = await transferStock({
      productId,
      quantity,
      fromLocationId: mode === 'add' ? null : event.stock_location_id,
      toLocationId: mode === 'add' ? event.stock_location_id : null,
      reason: mode === 'add' ? reasons.added(event.name) : reasons.removed(event.name),
      createdBy: user.id,
    })
    if ('error' in result) failures.push(`${skuOf.get(productId) ?? productId}: ${result.error.replace('at the source location', 'at this event')}`)
    else done.push(productId)
  }

  if (failures.length > 0) {
    return Response.json({
      error: mode === 'add' ? 'Some items could not be added' : 'Some items could not be removed',
      details: failures,
      done,
    }, { status: done.length > 0 ? 207 : 400 })
  }

  return Response.json({ success: true, done })
}
