import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'

/** GET /api/hr/activity?member_id=&limit=200 — the HR activity log, newest first. */
export async function GET(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const memberId = request.nextUrl.searchParams.get('member_id')
  // It goes into a PostgREST filter string below, so only a plain UUID is allowed.
  if (memberId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) {
    return Response.json({ error: 'member_id must be a UUID' }, { status: 400 })
  }
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 200, 1), 1000)
  let q = (await createServiceClient()).from('hr_audit_log')
    .select('id, created_at, actor_type, actor_member_id, actor_label, action, target_type, target_id, details, ip, user_agent')
    .order('created_at', { ascending: false }).limit(limit)
  // A person's own actions, plus admin actions done to them.
  if (memberId) q = q.or(`actor_member_id.eq.${memberId},details->>for_member_id.eq.${memberId}`)
  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ entries: data ?? [] })
}
