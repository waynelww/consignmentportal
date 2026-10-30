// Send log for the daily sales report. One row per store per recipient per
// attempt (daily cron or the store page's test send), written to
// public.daily_report_sends. A failure to write the log is logged to the
// console and never hides the outcome of the send itself.

import type { SupabaseClient } from '@supabase/supabase-js'

export type DailyReportKind = 'daily' | 'test'

export interface DailySendEntry {
  store_id: string
  store_code: string
  store_name: string
  report_date: string
  kind: DailyReportKind
  recipient: string
  status: 'sent' | 'failed'
  error?: string | null
  created_by?: string | null
}

export interface DailySendRow {
  id: string
  store_code: string
  store_name: string
  report_date: string
  kind: DailyReportKind
  recipient: string
  status: 'sent' | 'failed'
  error_message: string | null
  sent_at: string
}

const MAX_ERROR_LENGTH = 500

export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.slice(0, MAX_ERROR_LENGTH)
}

export async function recordDailySends(db: SupabaseClient, entries: DailySendEntry[]): Promise<void> {
  if (entries.length === 0) return
  const { error } = await db.from('daily_report_sends').insert(
    entries.map((e) => ({
      store_id: e.store_id,
      store_code: e.store_code,
      store_name: e.store_name,
      report_date: e.report_date,
      kind: e.kind,
      recipient: e.recipient,
      status: e.status,
      error_message: e.error ? e.error.slice(0, MAX_ERROR_LENGTH) : null,
      created_by: e.created_by ?? null,
    })),
  )
  if (error) console.error('[daily-report] could not write send log:', error.message)
}

export async function listRecentDailySends(db: SupabaseClient, storeId: string, limit = 5): Promise<DailySendRow[]> {
  const { data, error } = await db
    .from('daily_report_sends')
    .select('id, store_code, store_name, report_date, kind, recipient, status, error_message, sent_at')
    .eq('store_id', storeId)
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as DailySendRow[]
}
