/**
 * POST /api/cron/drive-uploads
 * Runs from .github/workflows/drive-uploads.yml (Vercel Hobby allows only 2
 * crons, so this is not a Vercel cron). Uploads queued delivery orders and
 * invoices to the XCMS Shared Drive. A backup: most rows are uploaded right
 * after the request that queued them (lib/drive/now.ts). See lib/drive/worker.ts.
 */
import { type NextRequest } from 'next/server'
import { runDriveWorker } from '@/lib/drive/worker'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runDriveWorker()
    console.log(
      `[cron drive-uploads] processed=${result.processed} done=${result.done} ` +
      `retried=${result.retried} failed=${result.failed} pending=${result.pending_remaining} ${result.elapsed_ms}ms`,
    )
    return Response.json({ success: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worker error'
    console.error('[cron drive-uploads]', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
