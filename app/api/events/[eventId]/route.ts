import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLocationIdByType } from '@/lib/inventory/transfer-stock'

export async function GET(
  _request: NextRequest,
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

  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single()

  if (eventErr || !event || !event.stock_location_id) {
    return Response.json({ error: 'Event not found' }, { status: 404 })
  }

  const officeId = await getLocationIdByType('office')
  const locId = event.stock_location_id

  // Every transfer that ever touched this event's location. Taken =
  // inbound; sold/returned = outbound, split by whether it went back to
  // Office (returned) or left the tracked system entirely (sold).
  const { data: transfers, error: transferErr } = await supabase
    .from('stock_transfers')
    .select('product_id, quantity, from_location_id, to_location_id')
    .or(`from_location_id.eq.${locId},to_location_id.eq.${locId}`)

  if (transferErr) return Response.json({ error: transferErr.message }, { status: 500 })

  const byProduct: Record<string, { taken: number; sold: number; returned: number }> = {}
  for (const t of transfers ?? []) {
    if (!byProduct[t.product_id]) byProduct[t.product_id] = { taken: 0, sold: 0, returned: 0 }
    const row = byProduct[t.product_id]
    if (t.to_location_id === locId) row.taken += t.quantity
    else if (t.from_location_id === locId && t.to_location_id === officeId) row.returned += t.quantity
    else if (t.from_location_id === locId && !t.to_location_id) row.sold += t.quantity
  }

  const productIds = Object.keys(byProduct)
  const { data: products } = productIds.length > 0
    ? await supabase.from('products').select('id, sku, name, image_url').in('id', productIds)
    : { data: [] }

  const productMap = new Map((products ?? []).map((p) => [p.id, p]))

  const items = productIds.map((pid) => {
    const agg = byProduct[pid]
    const closed = event.status === 'closed'
    return {
      product_id: pid,
      product: productMap.get(pid) ?? null,
      quantity_taken: agg.taken,
      quantity_sold_shopify: closed ? agg.sold : null,
      quantity_returned: closed ? agg.returned : null,
      variance: closed ? agg.returned - (agg.taken - agg.sold) : null,
    }
  })

  return Response.json({ event, items })
}
