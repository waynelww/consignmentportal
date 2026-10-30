/**
 * GET /api/cron/monthly-report
 * Driven by .github/workflows/monthly-report.yml on the 1st at 09:30 MYT,
 * after the 09:00 invoice run. Reports on the month before (or ?month=YYYY-MM).
 *
 * Emails the PDF and the Excel file to the monthly_report_email setting.
 * The recipient is never hard-coded; the run fails if the setting is blank.
 */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendMonthlyReportEmail } from '@/lib/email/send-email'
import { buildMonthlyReportFiles } from '@/lib/monthly-report'
import { previousMonthOf, monthLabel, parseYearMonth } from '@/lib/monthly-report/months'
import { todayMYT } from '@/lib/sales/last-sale'
import { summaryForEmail } from '@/lib/monthly-report/email-summary'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const keyParam = request.nextUrl.searchParams.get('key')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && keyParam !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requested = request.nextUrl.searchParams.get('month')
  const ym = requested ?? previousMonthOf(todayMYT())
  if (!parseYearMonth(ym)) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })

  const db = await createServiceClient()
  const { data: row } = await db.from('settings').select('value').eq('key', 'monthly_report_email').maybeSingle()
  const to = row?.value?.trim()
  if (!to) {
    console.error('[cron monthly-report] monthly_report_email setting is empty; nothing sent')
    return Response.json({ error: 'Setting monthly_report_email is empty' }, { status: 500 })
  }

  const files = await buildMonthlyReportFiles(db, ym)
  const { summary, actionCounts } = summaryForEmail(files.report)
  await sendMonthlyReportEmail({
    to,
    monthLabel: monthLabel(ym),
    baseName: files.baseName,
    pdf: files.pdf,
    xlsx: files.xlsx,
    summary,
    actionCounts,
  })

  return Response.json({
    ok: true,
    month: ym,
    to,
    stores_in_scope: files.report.stores.length,
    sales: files.report.headline.sales.value,
    actions: actionCounts,
  })
}
