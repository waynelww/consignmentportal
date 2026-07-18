import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchUnitsSoldAtLocation } from '@/lib/shopify/event-sales'

// Best-effort preview of units sold at this event's Shopify location, used
// to pre-fill the close-event review screen. Never blocks closing — if
// this fails or the event has no Shopify location attached, the frontend
// falls back to manual entry.
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

  const { data: event } = await supabase
    .from('events')
    .select('shopify_location_id, start_date, end_date, stock_location_id')
    .eq('id', eventId)
    .single()

  if (!event || !event.stock_location_id) return Response.json({ error: 'Event not found' }, { status: 404 })
  if (!event.shopify_location_id) {
    return Response.json({ error: 'This event has no Shopify location attached — enter sold quantities manually' }, { status: 400 })
  }

  try {
    const skuToQty = await fetchUnitsSoldAtLocation({
      locationId: event.shopify_location_id,
      startDate: event.start_date,
      endDate: event.end_date ?? new Date().toISOString().slice(0, 10),
    })

    // Products checked out to this event, read from the transfer ledger.
    const { data: transfers } = await supabase
      .from('stock_transfers')
      .select('product_id, products(sku)')
      .eq('to_location_id', event.stock_location_id)

    const result: Record<string, number> = {}
    for (const t of (transfers ?? []) as unknown as Array<{ product_id: string; products: { sku: string } | null }>) {
      const sku = (t.products?.sku ?? '').toUpperCase()
      result[t.product_id] = skuToQty.get(sku) ?? 0
    }

    return Response.json({ sold_by_product: result })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to fetch Shopify sales' }, { status: 502 })
  }
}
