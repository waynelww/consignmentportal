import { type NextRequest } from 'next/server'
import { authoriseFollowups } from '@/lib/followups/access'
import { loadFollowupMonth } from '@/lib/followups/load'
import { parseYearMonth } from '@/lib/monthly-report/months'

/**
 * GET /api/followups?month=YYYY-MM
 * The checklist for one month: XCMS stores (auto boxes), active extra stores
 * (hand-ticked boxes), hidden extra stores, and per-column outstanding counts.
 */
export async function GET(request: NextRequest) {
  const auth = await authoriseFollowups()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const month = request.nextUrl.searchParams.get('month') ?? ''
  if (!parseYearMonth(month)) {
    return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }

  try {
    const view = await loadFollowupMonth(month)
    return Response.json(view)
  } catch (err) {
    return Response.json(
      { error: 'Failed to load follow-ups', details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
