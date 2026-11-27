import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { transferStock } from '@/lib/inventory/transfer-stock'
import { posSoldByProduct } from '@/lib/pos/sold'
import { reasons, summariseEventLedger } from '@/lib/events/stock-ledger'

const CloseSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity_sold: z.number().int().min(0),
    quantity_returned: z.number().int().min(0),
  })).min(1),
})

/**
 * Close an event. The admin's review (sold, returned) is a record of what
 * came back; returned stock is NOT added to Office in XCMS (Office is updated
 * in Shopify and synced hourly). Steps:
 *   1. Sold above the POS figure (or all sold, without the POS) is deducted
 *      as "Sold at event …".
 *   2. Whatever is left in the event location is zeroed out with
 *      "Event closed — returned: <event>" (to = NULL), for every product.
 * The typed Returned counts are kept in event_close_counts (expected left,
 * returned, variance, closed_by, closed_at) — saved first, before any stock
 * moves. Variance = returned entered − what should have been left.
 */
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
  const locId: string = event.stock_location_id

  const { data: transfers } = await svc
    .from('stock_transfers')
    .select('product_id, quantity, from_location_id, to_location_id, reason')
    .or(`from_location_id.eq.${locId},to_location_id.eq.${locId}`)
  const ledger = summariseEventLedger(transfers ?? [], locId)

  // Event POS: when the POS was used, its sales (not voided) are the sold
  // quantities. They already left event stock at the moment of sale, so only
  // anything entered ABOVE the POS figure is deducted here.
  const pos = await posSoldByProduct(svc, eventId)

  const failures: string[] = []

  // Check everything BEFORE writing anything, so a rejected close never
  // leaves half of the "sold" rows applied (a retry would deduct them twice).
  const { data: stockNow } = await svc.from('location_stock').select('product_id, quantity').eq('location_id', locId)
  const inEvent = new Map((stockNow ?? []).map((r) => [r.product_id as string, r.quantity as number]))
  const toDeduct: Array<{ product_id: string; qty: number }> = []
  for (const item of parsed.data.items) {
    if (!ledger[item.product_id] || ledger[item.product_id].added === 0) {
      if (item.quantity_sold === 0 && item.quantity_returned === 0) continue
      failures.push(`${item.product_id}: no stock was ever added to this event`)
      continue
    }
    const posSold = pos.usesPos ? (pos.sold[item.product_id] ?? 0) : 0
    const soldToDeduct = pos.usesPos ? Math.max(0, item.quantity_sold - posSold) : item.quantity_sold
    const left = inEvent.get(item.product_id) ?? 0
    if (soldToDeduct > left) failures.push(`${item.product_id}: sold ${soldToDeduct} more than the ${left} left in event stock`)
    else if (soldToDeduct > 0) toDeduct.push({ product_id: item.product_id, qty: soldToDeduct })
  }
  if (failures.length > 0) {
    return Response.json({ error: 'Some quantities do not fit event stock — nothing was changed', details: failures }, { status: 400 })
  }

  // Record the admin's typed Returned counts against what should be left
  // (event stock after the outside-POS deduction) BEFORE any stock moves, so
  // the close history can never be missing. Upsert: a retried close
  // overwrites its own rows instead of duplicating them.
  const deductBy = new Map(toDeduct.map((d) => [d.product_id, d.qty]))
  const returnedBy = new Map(parsed.data.items.map((i) => [i.product_id, i.quantity_returned]))
  const countedIds = new Set<string>([
    ...parsed.data.items.filter((i) => (ledger[i.product_id]?.added ?? 0) > 0).map((i) => i.product_id),
    ...[...inEvent].filter(([, q]) => q > 0).map(([pid]) => pid),
  ])
  const closedAt = new Date().toISOString()
  const counts = [...countedIds].map((pid) => ({
    event_id: eventId,
    product_id: pid,
    expected_left: Math.max(0, (inEvent.get(pid) ?? 0) - (deductBy.get(pid) ?? 0)),
    returned: returnedBy.get(pid) ?? 0,
    closed_by: user.id,
    closed_at: closedAt,
  }))
  if (counts.length > 0) {
    const { error: countErr } = await svc.from('event_close_counts').upsert(counts, { onConflict: 'event_id,product_id' })
    if (countErr) {
      return Response.json({
        error: 'Could not save the close counts — nothing was changed',
        details: [`${countErr.message} (is migration 20261127_event_close_counts.sql applied?)`],
      }, { status: 500 })
    }
  }

  // 1. Sold outside the POS.
  for (const { product_id, qty } of toDeduct) {
    const soldResult = await transferStock({
      productId: product_id,
      quantity: qty,
      fromLocationId: locId,
      toLocationId: null,
      reason: pos.usesPos ? `Sold at event (outside POS): ${event.name}` : `Sold at event (Shopify): ${event.name}`,
      createdBy: user.id,
    })
    if ('error' in soldResult) failures.push(`${product_id}: ${soldResult.error}`)
  }

  if (failures.length > 0) {
    return Response.json({ error: 'Some items failed to close out', details: failures }, { status: 500 })
  }

  // 2. Zero out everything left in the event location — not into Office.
  const { data: leftRows, error: leftErr } = await svc
    .from('location_stock')
    .select('product_id, quantity')
    .eq('location_id', locId)
    .gt('quantity', 0)
  if (leftErr) return Response.json({ error: leftErr.message }, { status: 500 })

  const leftByProduct: Record<string, number> = {}
  for (const r of leftRows ?? []) {
    leftByProduct[r.product_id] = r.quantity
    const res = await transferStock({
      productId: r.product_id,
      quantity: r.quantity,
      fromLocationId: locId,
      toLocationId: null,
      reason: reasons.closedReturned(event.name),
      createdBy: user.id,
    })
    if ('error' in res) failures.push(`${r.product_id}: ${res.error}`)
  }

  if (failures.length > 0) {
    return Response.json({ error: 'Some leftover stock could not be cleared', details: failures }, { status: 500 })
  }

  const results = counts.map((c) => ({
    product_id: c.product_id,
    expected_left: c.expected_left,
    left: leftByProduct[c.product_id] ?? 0,
    returned: c.returned,
    variance: c.returned - c.expected_left,
  }))

  await svc.from('events').update({ status: 'closed', closed_at: closedAt }).eq('id', eventId)

  return Response.json({ success: true, results, tallies: results.every((r) => r.variance === 0) })
}
