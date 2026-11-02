import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { logHr } from '@/lib/hr/audit'
import { DriveScopeMissing, connectDrive } from '@/lib/hr/drive'

const STATE_COOKIE = 'xcms_hr_drive_state'

/** GET /api/hr/drive/callback — Google sends the admin back here after "Allow". */
export async function GET(request: NextRequest) {
  const back = (result: string) => {
    const res = NextResponse.redirect(`${request.nextUrl.origin}/admin/hr/manage?tab=settings&drive=${encodeURIComponent(result)}`)
    res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  }

  const auth = await authoriseHrAdmin()
  if (!auth.ok) return back('not-admin')

  const { searchParams } = request.nextUrl
  if (searchParams.get('error')) return back('cancelled')
  const state = searchParams.get('state')
  const code = searchParams.get('code')
  if (!code || !state || state !== request.cookies.get(STATE_COOKIE)?.value) return back('bad-state')

  const db = await createServiceClient()
  try {
    const account = await connectDrive(db, code, `${request.nextUrl.origin}/api/hr/drive/callback`)
    await logHr(db, request, { type: 'admin', label: auth.label }, 'drive.connected', null, { account })
    return back('connected')
  } catch (err) {
    console.error('[hr drive callback]', err)
    return back(err instanceof DriveScopeMissing ? 'drive-box-not-ticked' : 'failed')
  }
}
