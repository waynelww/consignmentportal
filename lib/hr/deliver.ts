import type { SupabaseClient } from '@supabase/supabase-js'
import { sendHrReportEmail } from '@/lib/email/send-email'
import { buildHrMonthReport, hrReportFileName, hrReportWorkbook, type HrMonthReport } from './report'

/** Builds the month's HR report and emails it (summary in the body, Excel attached). */
export async function sendHrReport(db: SupabaseClient, ym: string, to: string, isTest = false): Promise<HrMonthReport> {
  const report = await buildHrMonthReport(db, ym)
  await sendHrReportEmail({
    to,
    monthLabel: report.monthLabel,
    fileName: hrReportFileName(ym),
    xlsx: hrReportWorkbook(report),
    rows: report.rows.map((r) => ({
      name: r.name,
      claimsApproved: r.claimsApproved,
      toReimburse: r.toReimburse,
      penalties: r.penalties,
      lateCount: r.lateCount,
      leaveDays: r.leaveDays.annual + r.leaveDays.emergency + r.leaveDays.unpaid,
      mcDays: r.leaveDays.mc,
    })),
    totals: report.totals,
    pendingRequests: report.pendingRequests,
    isTest,
  })
  return report
}
