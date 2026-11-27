import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { posSoldByProduct } from '@/lib/pos/sold'
import { summariseEventLedger } from '@/lib/events/stock-ledger'

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

  const locId = event.stock_location_id

  // Everything comes from the event location and its ledger only — Office
  // is not part of event stock (see lib/events/stock-ledger.ts).
  const { data: transfers, error: transferErr } = await supabase
    .from('stock_transfers')
    .select('product_id, quantity, from_location_id, to_location_id, reason')
    .or(`from_location_id.eq.${locId},to_location_id.eq.${locId}`)
  if (transferErr) return Response.json({ error: transferErr.message }, { status: 500 })

  const svc = await createServiceClient()
  const byProduct = summariseEventLedger(transfers ?? [], locId)

  const { data: stockRows } = await svc.from('location_stock').select('product_id, quantity').eq('location_id', locId)
  const leftByProduct = new Map((stockRows ?? []).map((r) => [r.product_id as string, r.quantity as number]))
  for (const pid of leftByProduct.keys()) byProduct[pid] ??= { added: 0, soldPos: 0, soldOutside: 0, removed: 0, returned: 0 }

  // Event POS: units sold per product (not voided) — the close screen's
  // starting Sold figure. Same number as the ledger's POS sales.
  const pos = await posSoldByProduct(svc, eventId)
  for (const pid of Object.keys(pos.sold)) byProduct[pid] ??= { added: 0, soldPos: 0, soldOutside: 0, removed: 0, returned: 0 }

  const productIds = Object.keys(byProduct)
  const { data: products } = productIds.length > 0
    ? await supabase.from('products').select('id, sku, name, image_url').in('id', productIds)
    : { data: [] }

  const productMap = new Map((products ?? []).map((p) => [p.id, p]))

  const items = productIds.map((pid) => {
    const agg = byProduct[pid]
    return {
      product_id: pid,
      product: productMap.get(pid) ?? null,
      quantity_added: agg.added,
      quantity_sold_pos: pos.sold[pid] ?? 0,
      quantity_sold_outside: agg.soldOutside,
      quantity_removed: agg.removed,
      quantity_returned: agg.returned,
      quantity_left: leftByProduct.get(pid) ?? 0,
    }
  }).sort((a, b) => (a.product?.sku ?? '').localeCompare(b.product?.sku ?? ''))

  return Response.json({ event, items, uses_pos: pos.usesPos })
}
