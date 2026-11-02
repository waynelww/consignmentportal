import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hasGate, portalMember } from '@/lib/hr/portal-session'

/** GET /api/hr-portal/session — where the /hr page should start: password, name picker, or the person's page. */
export async function GET(request: NextRequest) {
  const db = await createServiceClient()
  const gate = await hasGate(request, db)
  const member = gate ? await portalMember(request, db) : null
  return Response.json({ gate, member })
}
