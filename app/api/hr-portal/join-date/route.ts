import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { portalMember } from '@/lib/hr/portal-session'
import { logHr } from '@/lib/hr/audit'
import { isValidJoinDate } from '@/lib/hr/rules'
import { todayMYT } from '@/lib/sales/last-sale'

/**
 * POST /api/hr-portal/join-date { join_date } — the signed-in person sets
 * their join date once (people who made a PIN before join dates were asked).
 * After that only the HR admin can change it.
 */
export async function POST(request: NextRequest) {
  const db = await createServiceClient()
  const me = await portalMember(request, db)
  if (!me) return Response.json({ error: 'Signed out' }, { status: 401 })

  const parsed = z.object({
    join_date: z.string().refine((d) => isValidJoinDate(d, todayMYT()), 'Enter the date you joined Xocks'),
  }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })

  const { data } = await db.from('xocks_team_members').update({ join_date: parsed.data.join_date })
    .eq('id', me.id).is('join_date', null).select('id')
  if (!data?.length) return Response.json({ error: 'Your join date is already set. Ask the admin to change it.' }, { status: 409 })
  await logHr(db, request, { type: 'staff', memberId: me.id, label: me.name }, 'join_date.set', { type: 'member', id: me.id }, parsed.data)
  return Response.json({ ok: true })
}
