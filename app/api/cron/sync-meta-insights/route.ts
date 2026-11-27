/**
 * GET /api/cron/sync-meta-insights
 * Driven by GitHub Actions (Vercel Hobby's 2 cron slots are taken) —
 * upserts daily ad-level Meta insights into meta_ad_insights.
 *
 * Default: re-fetches the trailing 28 days (attribution restatement window).
 * ?start=YYYY-MM-DD&end=YYYY-MM-DD runs an explicit slice (backfill).
 */
import { type NextRequest } from 'next/server'
import { syncMetaInsights } from '@/lib/meta/sync-insights'

export const maxDuration = 60

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const key = request.nextUrl.searchParams.get('key')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && key !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = request.nextUrl.searchParams.get('start') ?? undefined
  const end = request.nextUrl.searchParams.get('end') ?? undefined
  if ((start && !DATE_RE.test(start)) || (end && !DATE_RE.test(end))) {
    return Response.json({ error: 'start/end must be YYYY-MM-DD' }, { status: 400 })
  }

  const t0 = Date.now()
  const result = await syncMetaInsights({ start, end })
  const duration_ms = Date.now() - t0

  if (!result.success) {
    console.error('[cron sync-meta-insights]', result.error)
    return Response.json({ ok: false, error: result.error, duration_ms }, { status: result.status })
  }

  console.log(
    `[cron sync-meta-insights] ok · ${result.range.since}→${result.range.until} · ` +
      `pages=${result.pages} · rows=${result.rowsUpserted} · ${duration_ms}ms`,
  )

  return Response.json({ ok: true, duration_ms, ...result })
}
