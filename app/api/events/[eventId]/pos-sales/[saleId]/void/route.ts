import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess } from '@/lib/events/target-api'
import { posDbError } from '@/lib/pos/server'

// POST { reason } — void a POS sale: stock goes back to the event location,
// an audit row is kept, and later sales' bonus eligibility is recalculated.
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string; saleId: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { eventId, saleId } = await params
  const parsed = z.object({ reason: z.string().trim().min(1, 'Give a reason').max(300) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid' }, { status: 400 })
  const db = await createServiceClient()
  const { data: sale } = await db.from('pos_sales').select('id').eq('id', saleId).eq('event_id', eventId).maybeSingle()
  if (!sale) return Response.json({ error: 'Sale not found' }, { status: 404 })
  const { data, error } = await db.rpc('pos_void_sale', { p_sale_id: saleId, p_actor: ctx.user.id, p_reason: parsed.data.reason })
  if (error) { const e = posDbError(error.message); return Response.json({ error: e.error }, { status: e.status }) }
  return Response.json(data)
}
