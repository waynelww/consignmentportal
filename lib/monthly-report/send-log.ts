// Send log for the monthly report. Every attempt (cron or test) writes one row
// to public.monthly_report_sends. A failure to write the log is logged to the
// console and never hides the outcome of the send itself.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ReportSendKind = 'monthly' | 'test'

export interface ReportSendEntry {
  month_covered: string
  kind: ReportSendKind
  recipient: string | null
  status: 'sent' | 'failed'
  error?: string | null
  created_by?: string | null
}

export interface ReportSendRow {
  id: string
  month_covered: string
  sent_at: string
  kind: ReportSendKind
  recipient: string | null
  status: 'sent' | 'failed'
  error_message: string | null
}

const MAX_ERROR_LENGTH = 500

export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.slice(0, MAX_ERROR_LENGTH)
}

export async function recordReportSend(db: SupabaseClient, entry: ReportSendEntry): Promise<void> {
  const { error } = await db.from('monthly_report_sends').insert({
    month_covered: entry.month_covered,
    kind: entry.kind,
    recipient: entry.recipient,
    status: entry.status,
    error_message: entry.error ? entry.error.slice(0, MAX_ERROR_LENGTH) : null,
    created_by: entry.created_by ?? null,
  })
  if (error) console.error('[monthly-report] could not write send log:', error.message)
}

export async function listRecentReportSends(db: SupabaseClient, limit = 10): Promise<ReportSendRow[]> {
  const { data, error } = await db
    .from('monthly_report_sends')
    .select('id, month_covered, sent_at, kind, recipient, status, error_message')
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as ReportSendRow[]
}
