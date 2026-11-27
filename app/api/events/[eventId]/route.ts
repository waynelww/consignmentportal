import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { posSoldByProduct } from '@/lib/pos/sold'
import { summariseEventLedger } from '@/lib/events/stock-ledger'
import { isPatchSku } from '@/lib/pos/catalog'
import { patchesGiven } from '@/lib/pos/patches'

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

  // Closed events: the admin's typed Returned counts and variance at close
  // (event_close_counts). Missing table (migration not applied) = no counts.
  const closeCounts = new Map<string, { expected_left: number; returned: number; variance: number; closed_at: string }>()
  if (event.status === 'closed') {
    const { data: cc } = await svc.from('event_close_counts')
      .select('product_id, expected_left, returned, variance, closed_at')
      .eq('event_id', eventId)
    for (const r of cc ?? []) {
      closeCounts.set(r.product_id, r)
      byProduct[r.product_id] ??= { added: 0, soldPos: 0, soldOutside: 0, removed: 0, returned: 0 }
    }
  }

  const productIds = Object.keys(byProduct)
  const { data: products } = productIds.length > 0
    ? await supabase.from('products').select('id, sku, name, image_url').in('id', productIds)
    : { data: [] }

  const productMap = new Map((products ?? []).map((p) => [p.id, p]))

  // Patches have no event stock: left out of the stock table (see isPatchSku).
  const items = productIds.filter((pid) => !isPatchSku(productMap.get(pid)?.sku)).map((pid) => {
    const agg = byProduct[pid]
    const cc = closeCounts.get(pid)
    return {
      product_id: pid,
      product: productMap.get(pid) ?? null,
      quantity_added: agg.added,
      quantity_sold_pos: pos.sold[pid] ?? 0,
      quantity_sold_outside: agg.soldOutside,
      quantity_removed: agg.removed,
      quantity_returned: agg.returned,
      quantity_left: leftByProduct.get(pid) ?? 0,
      close_count: cc ? { expected_left: cc.expected_left, returned: cc.returned, variance: cc.variance } : null,
    }
  }).sort((a, b) => (a.product?.sku ?? '').localeCompare(b.product?.sku ?? ''))

  // Patches sold (RM4) and given free (FREE 6 / 10) through the POS, per day.
  const patches = await patchesGiven(svc, eventId)

  return Response.json({ event, items, uses_pos: pos.usesPos, has_close_counts: closeCounts.size > 0, patches })
}
