import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWayneCalc } from '@/lib/restock/wayne-api'
import { isValidMonth } from '@/lib/restock/wayne-calc'

// GET /api/bot/restock-calc?end_month=YYYY-MM&store_code=STR-015
// Read-only Restock Calculator (Wayne's method) for every active store, or
// one store by code. Nothing is saved — saving happens from the admin page.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const endMonth = searchParams.get('end_month')
  const storeCode = searchParams.get('store_code')
  if (endMonth && !isValidMonth(endMonth)) {
    return Response.json({ error: 'end_month must be YYYY-MM' }, { status: 400 })
  }

  try {
    const run = await runWayneCalc({
      endMonth,
      storeCodes: storeCode ? [storeCode] : undefined,
      db: createAdminClient(),
    })
    const summary = {
      restock_now: run.stores.filter((s) => s.status === 'restock_now').length,
      stock_ok: run.stores.filter((s) => s.status === 'stock_ok').length,
      not_enough_history: run.stores.filter((s) => s.status === 'not_enough_history').length,
      total_pairs_to_send: run.stores.reduce((a, s) => a + (s.status === 'restock_now' ? s.pairs_to_send ?? 0 : 0), 0),
    }
    return Response.json({ ...run, summary, generated_at: new Date().toISOString() })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Calculation failed' }, { status: 500 })
  }
}
