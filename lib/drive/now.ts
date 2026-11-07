// Upload Drive copies right away instead of waiting for the scheduled worker.
// Call AFTER queueing (queueOneDriveUpload / queueDriveUploads) in a request
// handler: the upload runs after the response is sent (next/server after()),
// so the user never waits for Google. Rows that are not pending (test or
// inactive store, DO not acknowledged, already done) are skipped. Any error
// leaves the row pending for the scheduled worker (/api/cron/drive-uploads).
//
// after() runs within the route's maxDuration, so routes using this export
// maxDuration = 60. Pass requestStartedAt (Date.now() at the start of the
// handler) when the request itself can take long: the upload budget is then
// BUDGET_MS minus the time already used.

import { after } from 'next/server'
import { BUDGET_MS, uploadDriveRowsNow } from './worker'
import { type DriveKind } from './layout'

export function uploadDriveAfterResponse(kind: DriveKind, recordIds: string[], requestStartedAt?: number): void {
  if (recordIds.length === 0) return
  after(async () => {
    const budgetMs = requestStartedAt === undefined ? BUDGET_MS : BUDGET_MS - (Date.now() - requestStartedAt)
    if (budgetMs <= 0) return // out of time: the scheduled worker picks them up
    await uploadDriveRowsNow(kind, recordIds, budgetMs)
  })
}
