import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { buildHrMonthReport, hrReportFileName, hrReportWorkbook } from '@/lib/hr/report'
import { sendHrReport } from '@/lib/hr/deliver'
import { loadHrSettings } from '@/lib/hr/settings'
import { parseYearMonth } from '@/lib/monthly-report/months'
import { todayMYT } from '@/lib/sales/last-sale'
import { logHr } from '@/lib/hr/audit'

export const maxDuration = 60

function monthParam(request: NextRequest): string | null {
  const ym = request.nextUrl.searchParams.get('month') ?? todayMYT().slice(0, 7)
  return parseYearMonth(ym) ? ym : null
}

/** GET /api/hr/report?month=YYYY-MM — download the month's HR Excel. */
export async function GET(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const ym = monthParam(request)
  if (!ym) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })

  const report = await buildHrMonthReport(await createServiceClient(), ym)
  return new Response(new Uint8Array(hrReportWorkbook(report)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${hrReportFileName(ym)}"`,
    },
  })
}

/** POST /api/hr/report?month=YYYY-MM — email the month's report now to the hr_report_email setting, marked [TEST]. */
export async function POST(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const ym = monthParam(request)
  if (!ym) return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })

  const db = await createServiceClient()
  const { email } = await loadHrSettings(db)
  if (!email) return Response.json({ error: 'Set the report email first' }, { status: 400 })
  try {
    await sendHrReport(db, ym, email, true)
    await logHr(db, request, { type: 'admin', label: auth.label }, 'report.sent', null, { month: ym, to: email })
    return Response.json({ ok: true, to: email })
  } catch (err) {
    return Response.json({ error: 'Send failed', details: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
