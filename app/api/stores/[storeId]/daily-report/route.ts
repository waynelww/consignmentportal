/**
 * GET  /api/stores/[storeId]/daily-report  → the last few sends for this store
 * POST /api/stores/[storeId]/daily-report  → "Send test report": today's sales
 *   so far (up to now), emailed to the store's saved recipients. Logged as kind 'test'.
 *
 * Admin only. Uses the saved recipients, not unsaved edits on the page.
 */
import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { todayMYT } from '@/lib/sales/last-sale'
import { groupStoresByRecipient } from '@/lib/daily-report/aggregate'
import { deliverDailyReports } from '@/lib/daily-report/deliver'
import { listRecentDailySends } from '@/lib/daily-report/send-log'
import { reportCutoffIso } from '@/lib/daily-report/settings'
import type { DailyStoreFields } from '@/lib/daily-report/report'

const STORE_FIELDS = 'id, store_code, store_name, pic_name, address, city, state, commission_rate, daily_report_recipients'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('id, role').eq('id', user.id).single()
  if (!profile) return { error: Response.json({ error: 'Profile not found' }, { status: 403 }) }
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return { error: Response.json({ error: 'Forbidden: admin only' }, { status: 403 }) }
  }
  return { supabase, userId: user.id }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { storeId } = await params

  const sends = await listRecentDailySends(auth.supabase, storeId, 5)
  return Response.json({ sends })
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { storeId } = await params

  const db = await createServiceClient()
  const { data: store, error } = await db.from('stores').select(STORE_FIELDS).eq('id', storeId).maybeSingle()
  if (error) return Response.json({ error: 'Could not load store', detail: error.message }, { status: 500 })
  if (!store) return Response.json({ error: 'Store not found' }, { status: 404 })

  const recipients = (store.daily_report_recipients as string[] | null) ?? []
  if (recipients.length === 0) {
    return Response.json({ error: 'Add at least one recipient and save before sending a test report' }, { status: 400 })
  }

  const date = todayMYT()
  const results = await deliverDailyReports(db, {
    date,
    cutoffIso: reportCutoffIso(date),
    groups: groupStoresByRecipient([store as DailyStoreFields & { daily_report_recipients: string[] }]),
    kind: 'test',
    createdBy: auth.userId,
  })

  if (results.every((r) => r.status === 'skipped')) {
    return Response.json({ ok: true, sent: false, date, message: 'No sales keyed in for today yet, so there is nothing to send.' })
  }
  const failed = results.filter((r) => r.status === 'failed')
  return Response.json({
    ok: failed.length === 0,
    sent: results.some((r) => r.status === 'sent'),
    date,
    results,
    ...(failed.length > 0 ? { error: failed[0].error } : {}),
  }, { status: failed.length > 0 ? 500 : 200 })
}
