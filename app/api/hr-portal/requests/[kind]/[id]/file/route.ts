/** GET /api/hr-portal/requests/[kind]/[id]/file — the signed-in person's own receipt or MC slip. */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { portalMember } from '@/lib/hr/portal-session'
import { streamHrFile } from '@/lib/hr/files'

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const db = await createServiceClient()
  const me = await portalMember(request, db)
  if (!me) return Response.json({ error: 'Signed out' }, { status: 401 })
  const { kind, id } = await params
  return streamHrFile(db, kind, id, me.id)
}
