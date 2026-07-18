import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { transferStock, getLocationIdByType } from '@/lib/inventory/transfer-stock'

// Records stock coming back from an event WITHOUT closing it — for
// partial/early returns during a multi-day event. Final reconciliation
// (Shopify sold tally, variance check) still happens via /close.
const ReturnSchema = z.object({
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

  const parsed = ReturnSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = await createServiceClient()

  const { data: event } = await svc.from('events').select('id, name, status, stock_location_id').eq('id', eventId).single()
  if (!event || !event.stock_location_id) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (event.status !== 'active') return Response.json({ error: 'Event is closed' }, { status: 400 })

  const officeId = await getLocationIdByType('office')
  if (!officeId) return Response.json({ error: 'Office location is not configured' }, { status: 500 })

  const failures: string[] = []

  for (const item of parsed.data.items) {
    const result = await transferStock({
      productId: item.product_id,
      quantity: item.quantity,
      fromLocationId: event.stock_location_id,
      toLocationId: officeId,
      reason: `Partial return: ${event.name}`,
      createdBy: user.id,
    })
    if ('error' in result) failures.push(`${item.product_id}: ${result.error}`)
  }

  if (failures.length > 0) {
    return Response.json({ error: 'Some items failed to return', details: failures }, { status: 500 })
  }

  return Response.json({ success: true })
}
