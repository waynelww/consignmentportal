import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess } from '@/lib/events/target-api'

const ReviewSchema = z.object({
  actual_sales: z.number().min(0).nullable(),
  tier2_hits: z.number().int().min(0).nullable(),
  review_notes: z.string().trim().max(4000).nullable(),
})

// Review fields stay editable even when the event is locked — locking only
// freezes the announced targets, not what actually happened.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { id } = await params

  const parsed = ReviewSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = await createServiceClient()
  const { data, error } = await svc
    .from('event_targets')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}
