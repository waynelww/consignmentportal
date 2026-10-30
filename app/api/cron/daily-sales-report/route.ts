/**
 * GET /api/cron/daily-sales-report
 * Driven by .github/workflows/daily-sales-report.yml at 22:00 MYT every day.
 *
 * Sends the internal daily sales report for each store whose switch is on,
 * except test accounts. Each recipient address gets one email with one PDF per
 * store that had sales that day. Work is batched by recipient so each call
 * stays under Vercel's 60s limit: pass ?offset=N (default 0) and ?limit=N
 * (default 10, max 10). The response's next_offset is null on the last batch.
 * ?date=YYYY-MM-DD re-runs a past day (default: today in Malaysia time).
 */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { loadTestStoreIds, isTestStore } from '@/lib/stores/test-accounts'
import { todayMYT } from '@/lib/sales/last-sale'
import { groupStoresByRecipient } from '@/lib/daily-report/aggregate'
import { deliverDailyReports } from '@/lib/daily-report/deliver'
import { isDateString, reportCutoffIso } from '@/lib/daily-report/settings'
import type { DailyStoreFields } from '@/lib/daily-report/report'

export const maxDuration = 60

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 10

function whole(value: string | null, fallback: number): number | null {
  if (value === null) return fallback
  return /^\d+$/.test(value) ? Number(value) : null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const keyParam = request.nextUrl.searchParams.get('key')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && keyParam !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const date = params.get('date') ?? todayMYT()
  if (!isDateString(date)) return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })

  const offset = whole(params.get('offset'), 0)
  const limit = whole(params.get('limit'), DEFAULT_LIMIT)
  if (offset === null) return Response.json({ error: 'offset must be a whole number' }, { status: 400 })
  if (limit === null || limit < 1) return Response.json({ error: 'limit must be a whole number from 1' }, { status: 400 })
  const batchSize = Math.min(limit, MAX_LIMIT)

  const db = await createServiceClient()
  const testIds = await loadTestStoreIds(db)

  const { data, error } = await db
    .from('stores')
    .select('id, store_code, store_name, pic_name, address, city, state, commission_rate, daily_report_recipients')
    .eq('daily_report_enabled', true)
  if (error) return Response.json({ error: 'Could not load stores', detail: error.message }, { status: 500 })

  const stores = (data ?? []).filter((s) => !isTestStore(testIds, s.id as string)) as Array<DailyStoreFields & { daily_report_recipients: string[] }>
  const groups = groupStoresByRecipient(stores)
  const batch = groups.slice(offset, offset + batchSize)

  const results = await deliverDailyReports(db, {
    date,
    cutoffIso: reportCutoffIso(date),
    groups: batch,
    kind: 'daily',
  })

  const next = offset + batchSize < groups.length ? offset + batchSize : null
  return Response.json({
    ok: true,
    date,
    recipients_total: groups.length,
    offset,
    next_offset: next,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results,
  })
}
