/**
 * GET /api/cron/hr-report
 * Driven by .github/workflows/hr-report.yml on the 1st at 10:00 MYT.
 * Reports on the month before (or ?month=YYYY-MM).
 *
 * Emails the HR summary + Excel to the hr_report_email setting. The
 * recipient is never hard-coded; the run fails if the setting is blank.
 */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendHrReport } from '@/lib/hr/deliver'
import { loadHrSettings } from '@/lib/hr/settings'
import { parseYearMonth, previousMonthOf } from '@/lib/monthly-report/months'
import { todayMYT } from '@/lib/sales/last-sale'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const keyParam = request.nextUrl.searchParams.get('key')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && keyParam !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ym = request.nextUrl.searchParams.get('month') ?? previousMonthOf(todayMYT())
  if (!parseYearMonth(ym)) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })

  const db = await createServiceClient()
  const { email } = await loadHrSettings(db)
  if (!email) {
    console.error('[cron hr-report] Setting hr_report_email is empty; nothing sent')
    return Response.json({ error: 'Setting hr_report_email is empty' }, { status: 500 })
  }

  try {
    const report = await sendHrReport(db, ym, email)
    return Response.json({ ok: true, month: ym, to: email, staff: report.rows.length, totals: report.totals })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[cron hr-report] send failed:', detail)
    return Response.json({ error: 'HR report failed to send', detail }, { status: 500 })
  }
}
