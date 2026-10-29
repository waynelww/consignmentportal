/**
 * GET /api/cron/low-stock-summary
 * Driven by .github/workflows/low-stock-summary.yml at 09:00 MYT daily.
 *
 * 1. Recalculates the 4-month plan levels for active stores (stores on the
 *    plan get their plan_level refreshed from the latest sales).
 * 2. Emails one summary to the operator address in the low_stock_alert_email
 *    setting: stores needing restock, worst first, with their low codes.
 *    This is the only low-stock alert: no in-app, push or WhatsApp.
 */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendLowStockSummaryEmail, type LowStockSummaryStore } from '@/lib/email/send-email'
import { recalcStockPlan, loadStockSnapshot } from '@/lib/restock/low-stock-data'
import { loadLowStockSettings } from '@/lib/restock/low-stock-settings'
import { malaysiaToday } from '@/lib/restock/wayne-calc'
import { formatStoreStock } from '@/lib/restock/low-stock'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const keyParam = request.nextUrl.searchParams.get('key')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && keyParam !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = await createServiceClient()
  const settings = await loadLowStockSettings(db)

  let plan
  try {
    plan = await recalcStockPlan({ db })
  } catch (err) {
    // Still send the summary on the last known plan levels.
    console.error('[cron low-stock-summary] plan recalc failed:', err)
    plan = { error: err instanceof Error ? err.message : String(err) }
  }

  const snapshot = await loadStockSnapshot(db, settings)
  const needing = snapshot.filter((s) => s.summary.needs_restock)

  const stores: LowStockSummaryStore[] = needing.map((s) => ({
    store_name: s.store_name,
    store_code: s.store_code,
    on_hand: s.summary.on_hand,
    stocked: s.summary.stocked,
    pct: s.summary.pct_of_stocked ?? 0,
    codes: s.codes.map((c) => ({
      sku: c.sku ?? '—',
      name: c.name ?? 'Unknown product',
      on_hand: c.on_hand,
      threshold: c.threshold,
      status: c.status === 'out_of_stock' ? 'out_of_stock' : 'low_stock',
    })),
  }))

  const date = malaysiaToday()
  await sendLowStockSummaryEmail({
    to: settings.alertEmail,
    date,
    stores,
    storesChecked: snapshot.length,
  })

  return Response.json({
    ok: true,
    date,
    plan,
    stores_checked: snapshot.length,
    stores_needing_restock: needing.length,
    lines: needing.map((s) => `${s.store_code} ${s.store_name}: ${formatStoreStock(s.summary)}`),
  })
}
