/** GET /api/hr/requests/[kind]/[id]/file — any receipt or MC slip, for the HR admin. */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { streamHrFile } from '@/lib/hr/files'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const { kind, id } = await params
  return streamHrFile(await createServiceClient(), kind, id)
}
