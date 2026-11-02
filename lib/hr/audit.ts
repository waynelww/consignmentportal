// Activity log for the HR module: every login and every change, with who,
// when, and from which device. Written with the service role; a failed write
// is logged to the console but never blocks the action itself.

import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getClientIp } from '@/lib/rate-limit'

export interface HrActor {
  type: 'staff' | 'admin' | 'visitor'
  memberId?: string | null
  label: string
}

export async function logHr(
  db: SupabaseClient,
  req: NextRequest,
  actor: HrActor,
  action: string,
  target?: { type: string; id?: string | null } | null,
  details?: Record<string, unknown> | null,
): Promise<void> {
  const { error } = await db.from('hr_audit_log').insert({
    actor_type: actor.type,
    actor_member_id: actor.memberId ?? null,
    actor_label: actor.label,
    action,
    target_type: target?.type ?? null,
    target_id: target?.id ?? null,
    details: details ?? null,
    ip: getClientIp(req),
    user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
  })
  if (error) console.error('[hr audit] write failed:', action, error.message)
}
