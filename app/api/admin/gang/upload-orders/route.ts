import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { uploadGangOrderNumbers, closeOutGangOrders } from '@/lib/gang/upload-orders'

const UploadSchema = z.object({
  type: z.literal('upload'),
  orderNumbers: z
    .array(z.object({ order_number: z.string().min(1), platform: z.string().optional() }))
    .min(1),
  batchDate: z.string().optional(),
})

const CloseOutSchema = z.object({
  type: z.literal('close_out'),
  beforeDate: z.string().optional(),
})

const Schema = z.discriminatedUnion('type', [UploadSchema, CloseOutSchema])

// POST /api/admin/gang/upload-orders
// Admin-session-authenticated (super_admin/ops_manager) equivalent of the
// bot's /api/bot/gang-upload-orders, for uploading via the web admin
// instead of Telegram. Shares the same reconciliation logic — see
// lib/gang/upload-orders.ts.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'ops_manager'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const admin = createAdminClient()

  try {
    if (parsed.data.type === 'upload') {
      const result = await uploadGangOrderNumbers(admin, parsed.data.orderNumbers, parsed.data.batchDate)
      return Response.json(result)
    }
    const invalidated = await closeOutGangOrders(admin, parsed.data.beforeDate)
    return Response.json({ invalidated })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
