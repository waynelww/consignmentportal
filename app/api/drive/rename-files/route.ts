/**
 * POST /api/drive/rename-files   body: { after?: uuid }
 * One-off rename of existing Drive copies to the current names (lib/drive/rename.ts).
 * Admin only (super_admin, ops_manager). Renames only; nothing is re-uploaded.
 * Call again with the returned next_after until finished is true.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { renameDoneDriveFilesBatch } from '@/lib/drive/rename'

export const maxDuration = 60

const Body = z.object({ after: z.string().uuid().nullable().optional() })

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = Body.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const svc = await createServiceClient()
    const result = await renameDoneDriveFilesBatch(svc, { after: parsed.data.after ?? null })
    return Response.json({ success: true, ...result })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Rename failed' }, { status: 500 })
  }
}
