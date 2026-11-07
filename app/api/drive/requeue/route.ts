/**
 * POST /api/drive/requeue   body: { kind: 'delivery_order' | 'invoice', ids: uuid[] }
 * Admin only (super_admin, ops_manager). Queues (or re-queues) records for the
 * Drive worker. Used by the admin "Retry" button and by admin pages after a
 * client-side status change. Queued rows are uploaded right after the response
 * (lib/drive/now.ts); anything not finished is left for the scheduled worker.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { queueDriveUploads } from '@/lib/drive/queue'
import { uploadDriveAfterResponse } from '@/lib/drive/now'

const Body = z.object({
  kind: z.enum(['delivery_order', 'invoice']),
  ids: z.array(z.string().uuid()).min(1).max(200),
})

export const maxDuration = 60 // room for the Drive uploads after the response

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const { kind, ids } = parsed.data

  // Take each record's store from the source table (the queue row needs it).
  const svc = await createServiceClient()
  const table = kind === 'delivery_order' ? 'delivery_orders' : 'commission_periods'
  const { data: rows, error } = await svc.from(table).select('id, store_id').in('id', ids)
  if (error) return Response.json({ error: 'Could not read records' }, { status: 500 })

  const result = await queueDriveUploads(
    svc,
    kind,
    (rows ?? []).map((r) => ({ recordId: r.id as string, storeId: r.store_id as string })),
  )
  uploadDriveAfterResponse(kind, (rows ?? []).map((r) => r.id as string))
  return Response.json({ success: true, ...result, not_found: ids.length - (rows ?? []).length })
}
