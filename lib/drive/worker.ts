// Drive upload worker. Called by POST /api/cron/drive-uploads every 15 minutes
// (GitHub Actions). Takes pending rows oldest-queued first, renders each PDF,
// uploads it, and records the result. It stops starting new rows after
// BUDGET_MS so it always finishes inside the 60s function limit.
//
// Failure handling: attempts +1 and last_error saved; the row stays pending and
// is retried on the next run. After MAX_ATTEMPTS it is marked failed and waits
// for an admin "Retry" (which resets it).

import { createServiceClient } from '@/lib/supabase/server'
import { driveFileUrl, driveRootFolderId, findOrCreateFolder, uploadOrReplacePdf } from '@/lib/google/drive'
import { renderRecord } from './render'
import { type DriveKind } from './layout'
import { purgeUnwantedDeliveryOrderCopies, type PurgeResult } from './purge'

export const BUDGET_MS = 40_000
export const MAX_ATTEMPTS = 5

interface UploadRow {
  id: string
  kind: DriveKind
  record_id: string
  attempts: number
  drive_file_id: string | null
  updated_at: string
}

export interface WorkerResult {
  purge: PurgeResult | { error: string }
  processed: number
  waiting: number     // delivery orders not signed yet: left pending
  done: number
  retried: number     // failed this run, still pending for the next run
  failed: number      // reached MAX_ATTEMPTS this run
  pending_remaining: number
  elapsed_ms: number
}

function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.slice(0, 500)
}

export async function runDriveWorker(): Promise<WorkerResult> {
  const started = Date.now()
  const svc = await createServiceClient()

  let purge: PurgeResult | { error: string }
  try {
    purge = await purgeUnwantedDeliveryOrderCopies(svc)
  } catch (err) {
    purge = { error: err instanceof Error ? err.message : 'purge failed' }
    console.error('[drive-purge]', purge.error)
  }

  const { data: rows, error } = await svc
    .from('drive_uploads')
    .select('id, kind, record_id, attempts, drive_file_id, updated_at')
    .eq('status', 'pending')
    .order('updated_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(`Could not read the Drive queue: ${error.message}`)

  const folderCache = new Map<string, string>()
  const folderFor = async (folderName: string, subfolder: string): Promise<string> => {
    const key = `${folderName}|${subfolder}`
    const cached = folderCache.get(key)
    if (cached) return cached
    const root = driveRootFolderId()
    const storeFolder = await findOrCreateFolder(folderName, root)
    const id = await findOrCreateFolder(subfolder, storeFolder)
    folderCache.set(key, id)
    return id
  }

  let processed = 0
  let waiting = 0
  let done = 0
  let retried = 0
  let failed = 0

  for (const row of (rows ?? []) as UploadRow[]) {
    if (Date.now() - started > BUDGET_MS) break
    processed++

    try {
      const rendered = await renderRecord(svc, row.kind, row.record_id)
      if (!rendered) {
        waiting++
        continue // not signed yet: stays pending, no attempt counted
      }
      const folderId = await folderFor(rendered.folderName, rendered.subfolder)
      const fileId = await uploadOrReplacePdf({
        folderId,
        name: rendered.fileName,
        bytes: rendered.bytes,
        existingFileId: row.drive_file_id,
      })
      // Only mark done if the row was not re-queued while we were uploading
      // (e.g. the store signed the DO meanwhile): then it stays pending and the
      // next run uploads the newer copy.
      const { data: doneRows, error: doneErr } = await svc
        .from('drive_uploads')
        .update({
          status: 'done',
          drive_file_id: fileId,
          drive_url: driveFileUrl(fileId),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('updated_at', row.updated_at)
        .select('id')
      if (doneErr) throw new Error(`Uploaded, but could not record it: ${doneErr.message}`)
      if (doneRows && doneRows.length > 0) done++
    } catch (err) {
      const attempts = row.attempts + 1
      const giveUp = attempts >= MAX_ATTEMPTS
      await svc
        .from('drive_uploads')
        .update({
          status: giveUp ? 'failed' : 'pending',
          attempts,
          last_error: errorText(err),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (giveUp) failed++
      else retried++
      console.error(`[drive-uploads] ${row.kind} ${row.record_id} attempt ${attempts} failed:`, errorText(err))
    }
  }

  const { count } = await svc
    .from('drive_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  return {
    purge,
    processed,
    waiting,
    done,
    retried,
    failed,
    pending_remaining: count ?? 0,
    elapsed_ms: Date.now() - started,
  }
}
