import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { posSession } from '@/lib/pos/session'
import { loadPosCatalog, loadPosDiscounts } from '@/lib/pos/server'

// GET — products with stock at the event location + the discount list.
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const db = await createServiceClient()
  const s = await posSession(request, db, eventId)
  if (!s) return Response.json({ error: 'Signed out' }, { status: 401 })
  if (!s.event.stock_location_id) return Response.json({ error: 'Event has no stock location' }, { status: 500 })
  try {
    const [products, discounts] = await Promise.all([
      loadPosCatalog(db, s.event.stock_location_id),
      loadPosDiscounts(db, eventId),
    ])
    return Response.json({ products, discounts })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed to load' }, { status: 500 })
  }
}
