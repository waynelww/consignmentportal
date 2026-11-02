import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { MEMBER_COOKIE, portalMember } from '@/lib/hr/portal-session'
import { logHr } from '@/lib/hr/audit'

/** POST /api/hr-portal/logout — signs the person out; the link password stays remembered on this device. */
export async function POST(request: NextRequest) {
  const db = await createServiceClient()
  const me = await portalMember(request, db)
  if (me) await logHr(db, request, { type: 'staff', memberId: me.id, label: me.name }, 'logout')
  const res = NextResponse.json({ ok: true })
  res.cookies.set(MEMBER_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
