/**
 * POST /api/drive/backfill
 * super_admin or ops_manager. Queues every delivery order and invoice created on or after
 * 1 Nov 2026 (MYT) for the Drive worker, skipping test stores and anything that
 * is already done. Nothing before November is touched. Only queues.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { backfillDriveUploads } from '@/lib/drive/queue'

export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  try {
    const svc = await createServiceClient()
    const result = await backfillDriveUploads(svc)
    return Response.json({ success: true, ...result })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Backfill failed' }, { status: 500 })
  }
}
