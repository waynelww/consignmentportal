import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { transferStock, getLocationIdByType } from '@/lib/inventory/transfer-stock'

const MAX_QTY = 9999

const TransferSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().positive().max(MAX_QTY),
  from_location_id: z.string().uuid().optional().nullable(),
  to_location_id: z.string().uuid().optional().nullable(),
  reason: z.string().trim().max(500).optional().default(''),
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

  const parsed = TransferSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }
  const { product_id, quantity, from_location_id, to_location_id, reason } = parsed.data

  if (!from_location_id && !to_location_id) {
    return Response.json({ error: 'A transfer needs a source or a destination' }, { status: 400 })
  }

  const officeId = await getLocationIdByType('office')
  const finalReason = reason || (
    from_location_id === officeId ? 'Stock moved from Office'
    : to_location_id === officeId ? 'Stock moved into Office'
    : 'Stock transfer'
  )

  const result = await transferStock({
    productId: product_id,
    quantity,
    fromLocationId: from_location_id ?? null,
    toLocationId: to_location_id ?? null,
    reason: finalReason,
    createdBy: user.id,
  })

  if ('error' in result) return Response.json({ error: result.error }, { status: 500 })

  return Response.json({ success: true })
}
