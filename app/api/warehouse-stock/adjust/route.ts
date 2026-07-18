import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { adjustWarehouseStock } from '@/lib/inventory/adjust-warehouse-stock'

const MAX_DELTA = 9999

const AdjustSchema = z.object({
  product_id: z.string().uuid(),
  delta: z.number().int().refine((n) => n !== 0, 'Delta cannot be zero').refine((n) => Math.abs(n) <= MAX_DELTA, `Delta cannot exceed ${MAX_DELTA}`),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
  // Only set internally by the events checkout/return flows — not client-settable to arbitrary values
  reference_type: z.enum(['manual', 'event_checkout', 'event_return']).optional().default('manual'),
  reference_id: z.string().uuid().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const parsed = AdjustSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }
  const { product_id, delta, reason, reference_type, reference_id } = parsed.data

  const result = await adjustWarehouseStock({
    productId: product_id,
    delta,
    reason,
    referenceType: reference_type,
    referenceId: reference_id,
    createdBy: user.id,
  })

  if ('error' in result) return Response.json({ error: result.error }, { status: 500 })

  return Response.json({ success: true, quantity_before: result.quantityBefore, quantity_after: result.quantityAfter })
}
