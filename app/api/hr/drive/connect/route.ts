import { type NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { driveAuthUrl, driveConfigured } from '@/lib/hr/drive'

const DRIVE_STATE_COOKIE = 'xcms_hr_drive_state'

/** GET /api/hr/drive/connect — sends the HR admin to Google to allow access to a Drive folder. */
export async function GET(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  if (!driveConfigured()) {
    return Response.json({ error: 'Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in Vercel first' }, { status: 400 })
  }
  // Random state, checked on the way back, so nobody else can finish this flow.
  const state = randomBytes(16).toString('base64url')
  const res = NextResponse.redirect(driveAuthUrl(`${request.nextUrl.origin}/api/hr/drive/callback`, state))
  res.cookies.set(DRIVE_STATE_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 })
  return res
}
