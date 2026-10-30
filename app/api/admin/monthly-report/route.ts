/**
 * Admin-only monthly report tools (used by the Settings page).
 *
 *   GET  /api/admin/monthly-report?format=pdf|xlsx&month=YYYY-MM
 *        Downloads the report file. Month defaults to last month.
 *   POST /api/admin/monthly-report   { "action": "test" }
 *        Sends last month's report (both files) to TEST_REPORT_RECIPIENT.
 *        Does not touch the monthly recipient setting.
 */
import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendMonthlyReportEmail } from '@/lib/email/send-email'
import { buildMonthlyReportFiles } from '@/lib/monthly-report'
import { previousMonthOf, monthLabel, parseYearMonth } from '@/lib/monthly-report/months'
import { TEST_REPORT_RECIPIENT } from '@/lib/monthly-report/settings'
import { summaryForEmail } from '@/lib/monthly-report/email-summary'
import { todayMYT } from '@/lib/sales/last-sale'

export const maxDuration = 120

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'ops_manager'].includes(profile.role)) {
    return { error: Response.json({ error: 'Forbidden: admin only' }, { status: 403 }) }
  }
  return { error: null }
}

function monthParam(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get('month')
  if (!raw) return previousMonthOf(todayMYT())
  return parseYearMonth(raw) ? raw : null
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

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
  const files = await buildMonthlyReportFiles(await createServiceClient(), ym)
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
  return Response.json({ ok: true, month: ym, to: TEST_REPORT_RECIPIENT })
}
