import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { MEMBER_COOKIE, MEMBER_MAX_AGE, PIN_PATTERN, cookieOptions, hasGate, hashSecret, memberToken } from '@/lib/hr/portal-session'
import { logHr } from '@/lib/hr/audit'
import { TEAM_NAME_DUPLICATE } from '@/lib/xocks-team/access'
import { isValidJoinDate } from '@/lib/hr/rules'
import { todayMYT } from '@/lib/sales/last-sale'

/** GET /api/hr-portal/members — names to pick from (gate required). No hashes leave the server. */
export async function GET(request: NextRequest) {
  const db = await createServiceClient()
  if (!(await hasGate(request, db))) return Response.json({ error: 'Locked' }, { status: 401 })
  const { data, error } = await db.from('xocks_team_members').select('id, name, hr_pin_hash, join_date').eq('active', true).order('name')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ members: (data ?? []).map((m) => ({ id: m.id, name: m.name, has_pin: !!m.hr_pin_hash, has_join_date: !!m.join_date })) })
}

/** POST /api/hr-portal/members { name, pin, join_date } — a new person adds their name, PIN and join date, and is signed in. */
export async function POST(request: NextRequest) {
  const db = await createServiceClient()
  if (!(await hasGate(request, db))) return Response.json({ error: 'Locked' }, { status: 401 })

  const parsed = z.object({
    name: z.string().trim().min(1, 'Enter your name').max(60),
    pin: z.string().regex(PIN_PATTERN, 'PIN must be 4 to 6 digits'),
    join_date: z.string().refine((d) => isValidJoinDate(d, todayMYT()), 'Enter the date you joined Xocks'),
  }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })

  const pinHash = hashSecret(parsed.data.pin)
  const { data, error } = await db.from('xocks_team_members')
    .insert({ name: parsed.data.name, hr_pin_hash: pinHash, join_date: parsed.data.join_date }).select('id, name').single()
  if (error?.code === '23505') return Response.json({ error: TEAM_NAME_DUPLICATE }, { status: 409 })
  if (error || !data) return Response.json({ error: 'Could not add your name', details: error?.message }, { status: 500 })

  await logHr(db, request, { type: 'staff', memberId: data.id, label: data.name }, 'member.added', { type: 'member', id: data.id },
    { join_date: parsed.data.join_date })
  const res = NextResponse.json({ member: data }, { status: 201 })
  res.cookies.set(MEMBER_COOKIE, memberToken(data.id, pinHash), cookieOptions(MEMBER_MAX_AGE))
  return res
}
