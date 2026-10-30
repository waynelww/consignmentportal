/**
 * Admin-only monthly report tools (used by the Settings page).
 *
 *   GET  /api/admin/monthly-report?list=sends
 *        Recent send log rows, newest first (for the Settings card).
 *   GET  /api/admin/monthly-report?format=pdf|xlsx&month=YYYY-MM
 *        Downloads the report file. Month defaults to last month.
 *   POST /api/admin/monthly-report   { "action": "test" }
 *        Sends last month's report (both files) to TEST_REPORT_RECIPIENT.
 *        Does not touch the monthly recipient setting. Logged as kind 'test'.
 */
import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendMonthlyReportEmail } from '@/lib/email/send-email'
import { buildMonthlyReportFiles } from '@/lib/monthly-report'
import { previousMonthOf, monthLabel, parseYearMonth } from '@/lib/monthly-report/months'
import { TEST_REPORT_RECIPIENT } from '@/lib/monthly-report/settings'
import { summaryForEmail } from '@/lib/monthly-report/email-summary'
import { recordReportSend, listRecentReportSends, errorText } from '@/lib/monthly-report/send-log'
import { todayMYT } from '@/lib/sales/last-sale'

export const maxDuration = 120

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }), userId: null }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'ops_manager'].includes(profile.role)) {
    return { error: Response.json({ error: 'Forbidden: admin only' }, { status: 403 }), userId: null }
  }
  return { error: null, userId: user.id }
}

function monthParam(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get('month')
  if (!raw) return previousMonthOf(todayMYT())
  return parseYearMonth(raw) ? raw : null
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  if (request.nextUrl.searchParams.get('list') === 'sends') {
    const rows = await listRecentReportSends(await createServiceClient(), 10)
    return Response.json(rows, { headers: { 'Cache-Control': 'no-store' } })
  }

  const ym = monthParam(request)
  if (!ym) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'pdf'

  const files = await buildMonthlyReportFiles(await createServiceClient(), ym)
  const isPdf = format === 'pdf'
  return new Response(new Blob([new Uint8Array(isPdf ? files.pdf : files.xlsx)]), {
    headers: {
      'Content-Type': isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${files.baseName}.${format}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null) as { action?: string } | null
  if (body?.action !== 'test') return Response.json({ error: 'Unknown action' }, { status: 400 })

  const ym = previousMonthOf(todayMYT())
  const db = await createServiceClient()
  const log = { month_covered: ym, kind: 'test' as const, recipient: TEST_REPORT_RECIPIENT, created_by: auth.userId }
  try {
    const files = await buildMonthlyReportFiles(db, ym)
    const { summary, actionCounts } = summaryForEmail(files.report)
    await sendMonthlyReportEmail({
      to: TEST_REPORT_RECIPIENT,
      monthLabel: monthLabel(ym),
      baseName: files.baseName,
      pdf: files.pdf,
      xlsx: files.xlsx,
      summary,
      actionCounts,
      isTest: true,
    })
  } catch (err) {
    const error = errorText(err)
    await recordReportSend(db, { ...log, status: 'failed', error })
    return Response.json({ error: 'Test report failed to send', detail: error }, { status: 500 })
  }
  await recordReportSend(db, { ...log, status: 'sent' })
  return Response.json({ ok: true, month: ym, to: TEST_REPORT_RECIPIENT })
}
