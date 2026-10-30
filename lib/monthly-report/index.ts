// Server entry point: loads the month, computes the report and renders both
// files. Used by the monthly cron, the admin download and the test send.

import type { SupabaseClient } from '@supabase/supabase-js'
import { todayMYT } from '../sales/last-sale'
import { loadMonthlyReportInput } from './load'
import { computeMonthlyReport, type MonthlyReport } from './compute'
import { generateMonthlyReportPdf } from './pdf'
import { buildMonthlyReportWorkbook } from './excel'
import { monthFileTag } from './months'

export interface MonthlyReportFiles {
  report: MonthlyReport
  pdf: Uint8Array
  xlsx: Buffer
  /** File name without extension, e.g. "XCMS_Monthly_Report_Sep2026". */
  baseName: string
}

export async function buildMonthlyReportFiles(db: SupabaseClient, ym: string): Promise<MonthlyReportFiles> {
  const input = await loadMonthlyReportInput(db, ym, todayMYT())
  const report = computeMonthlyReport(input)
  const [pdf, xlsx] = await Promise.all([generateMonthlyReportPdf(report), Promise.resolve(buildMonthlyReportWorkbook(report))])
  return { report, pdf, xlsx, baseName: `XCMS_Monthly_Report_${monthFileTag(ym)}` }
}
