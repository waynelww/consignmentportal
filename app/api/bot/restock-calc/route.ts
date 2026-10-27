import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWayneCalc } from '@/lib/restock/wayne-api'
import { DEFAULT_PERIOD_MONTHS, describePeriod, isPeriodMonths } from '@/lib/restock/wayne-calc'

// GET /api/bot/restock-calc?months=2|3&store_code=STR-015
// Read-only Restock Calculator (Wayne's method) for every active store, or
// one store by code. Each store's period ends on its last recorded sale.
// Nothing is saved — saving happens from the admin page.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const monthsParam = searchParams.get('months')
  const months = monthsParam === null ? DEFAULT_PERIOD_MONTHS : Number(monthsParam)
  const storeCode = searchParams.get('store_code')
  if (!isPeriodMonths(months)) {
    return Response.json({ error: 'months must be 2 or 3' }, { status: 400 })
  }

  try {
    const run = await runWayneCalc({
      months,
      storeCodes: storeCode ? [storeCode] : undefined,
      db: createAdminClient(),
    })
    const stores = run.stores.map((s) => ({ ...s, period_label: describePeriod(s.period) }))
    const summary = {
      restock_now: stores.filter((s) => s.status === 'restock_now').length,
      stock_ok: stores.filter((s) => s.status === 'stock_ok').length,
      not_enough_history: stores.filter((s) => s.status === 'not_enough_history').length,
      short_history: stores.filter((s) => s.status !== 'not_enough_history' && s.period.short_history).length,
      total_pairs_to_send: stores.reduce((a, s) => a + (s.status === 'restock_now' ? s.pairs_to_send ?? 0 : 0), 0),
    }
    return Response.json({ ...run, stores, summary, generated_at: new Date().toISOString() })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Calculation failed' }, { status: 500 })
  }
}
