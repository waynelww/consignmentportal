import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { uploadGangOrderNumbers, closeOutGangOrders } from '@/lib/gang/upload-orders'

const UploadSchema = z.object({
  type: z.literal('upload'),
  orderNumbers: z
    .array(
      z.object({
        order_number: z.string().min(1),
        platform: z.string().optional(),
        items: z.array(z.object({ product_name: z.string().min(1), quantity: z.number().int().positive() })).optional(),
      }),
    )
    .min(1),
  batchDate: z.string().optional(),
})

const CloseOutSchema = z.object({
  type: z.literal('close_out'),
  beforeDate: z.string().optional(),
})

const Schema = z.discriminatedUnion('type', [UploadSchema, CloseOutSchema])

// POST /api/bot/gang-upload-orders
// Bot-authenticated. See lib/gang/upload-orders.ts for the shared logic
// (also used by the admin-session equivalent at /api/admin/gang/upload-orders).
export async function POST(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createAdminClient()

  try {
    if (parsed.data.type === 'upload') {
      const result = await uploadGangOrderNumbers(supabase, parsed.data.orderNumbers, parsed.data.batchDate)
      return Response.json(result)
    }
    const invalidated = await closeOutGangOrders(supabase, parsed.data.beforeDate)
    return Response.json({ invalidated })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
