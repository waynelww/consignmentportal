// Removes Drive copies of delivery orders that should not have one: any DO that
// is no longer 'acknowledged' (still being prepared, dispatched, delivered,
// cancelled, or deleted). The file is moved to the Drive trash and the queue row
// is deleted. If the trash step fails the row is kept, so the next run retries.
// Runs at the start of every worker run; it is idempotent.

import type { SupabaseClient } from '@supabase/supabase-js'
import { trashDriveFile } from '@/lib/google/drive'
import { acknowledgedDeliveryOrderIds, selectAll } from './queue'

export interface PurgeResult {
  checked: number
  removed: number
  trashed: number
  errors: number
}

export async function purgeUnwantedDeliveryOrderCopies(svc: SupabaseClient): Promise<PurgeResult> {
  const rows = await selectAll<{ id: string; record_id: string; drive_file_id: string | null }>((from, to) =>
    svc
      .from('drive_uploads')
      .select('id, record_id, drive_file_id')
      .eq('kind', 'delivery_order')
      .order('id', { ascending: true })
      .range(from, to),
  )

  const wanted = await acknowledgedDeliveryOrderIds(svc, rows.map((r) => r.record_id))

  let removed = 0
  let trashed = 0
  let errors = 0
  for (const row of rows) {
    if (wanted.has(row.record_id)) continue

    if (row.drive_file_id) {
      try {
        await trashDriveFile(row.drive_file_id)
        trashed++
      } catch (err) {
        errors++
        console.error('[drive-purge] could not trash file for DO', row.record_id, err instanceof Error ? err.message : err)
        continue // keep the row so the next run retries
      }
    }

    const { error } = await svc.from('drive_uploads').delete().eq('id', row.id)
    if (error) {
      errors++
      console.error('[drive-purge] could not delete queue row', row.id, error.message)
      continue
    }
    removed++
  }

  return { checked: rows.length, removed, trashed, errors }
}
