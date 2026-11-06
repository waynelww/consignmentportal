// Queueing Drive copies. Called from request handlers AFTER the DO / invoice is
// saved: this only writes a 'pending' row; the worker does the rendering and
// upload. A queue failure is logged and never fails the user's request (the
// record is already saved, and the backfill button can queue it again).
//
// Rules:
//  - Test stores (stores.is_test) are never queued (lib/stores/test-accounts.ts).
//  - A delivery order is only queued once it is 'acknowledged' (received). Any
//    other status is ignored here, and the worker only uploads its signed copy.
//  - Invoices are queued as they are created.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadTestStoreIds } from '@/lib/stores/test-accounts'
import { BACKFILL_FROM_ISO, type DriveKind } from './layout'

export interface QueueItem {
  recordId: string
  storeId: string
}

export interface QueueResult {
  queued: number
  skippedTest: number
  skippedNotAcknowledged: number
}

const BATCH = 200

/** A delivery order gets a Drive copy only once it is received (acknowledged). */
export function deliveryOrderCopyWanted(status: string | null | undefined): boolean {
  return status === 'acknowledged'
}

/** Queue (or re-queue) records. Re-queuing resets attempts and keeps the existing Drive file id. */
export async function queueDriveUploads(
  svc: SupabaseClient,
  kind: DriveKind,
  items: QueueItem[],
): Promise<QueueResult> {
  // De-duplicate: one Postgres upsert cannot touch the same row twice.
  const unique = new Map<string, QueueItem>()
  for (const item of items) unique.set(item.recordId, item)
  const list = [...unique.values()]
  if (list.length === 0) return { queued: 0, skippedTest: 0, skippedNotAcknowledged: 0 }

  let candidates = list
  if (kind === 'delivery_order') {
    const wanted = await acknowledgedDeliveryOrderIds(svc, list.map((i) => i.recordId))
    candidates = list.filter((i) => wanted.has(i.recordId))
  }
  const skippedNotAcknowledged = list.length - candidates.length

  const testIds = await loadTestStoreIds(svc)
  const eligible = candidates.filter((i) => !testIds.has(i.storeId))
  const now = new Date().toISOString()

  for (let i = 0; i < eligible.length; i += BATCH) {
    const rows = eligible.slice(i, i + BATCH).map((item) => ({
      kind,
      record_id: item.recordId,
      store_id: item.storeId,
      status: 'pending',
      attempts: 0,
      last_error: null,
      updated_at: now,
    }))
    const { error } = await svc.from('drive_uploads').upsert(rows, { onConflict: 'kind,record_id' })
    if (error) throw new Error(`Drive queue failed: ${error.message}`)
  }
  return {
    queued: eligible.length,
    skippedTest: candidates.length - eligible.length,
    skippedNotAcknowledged,
  }
}

/** IDs (of the given list) whose delivery order is currently acknowledged. Missing DOs are not included. */
export async function acknowledgedDeliveryOrderIds(svc: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data, error } = await svc
      .from('delivery_orders')
      .select('id, status')
      .in('id', ids.slice(i, i + BATCH))
    if (error) throw new Error(`Could not read delivery order status: ${error.message}`)
    for (const row of data ?? []) {
      if (deliveryOrderCopyWanted(row.status as string)) out.add(row.id as string)
    }
  }
  return out
}

/** Same as queueDriveUploads, but logs and swallows errors. Use from request handlers. */
export async function queueDriveUploadsSafe(
  svc: SupabaseClient,
  kind: DriveKind,
  items: QueueItem[],
): Promise<void> {
  try {
    await queueDriveUploads(svc, kind, items)
  } catch (err) {
    console.error(`[drive-queue] could not queue ${kind} copies:`, err instanceof Error ? err.message : err)
  }
}

/** Single-record convenience for the common case. */
export async function queueOneDriveUpload(
  svc: SupabaseClient,
  kind: DriveKind,
  recordId: string,
  storeId: string,
): Promise<void> {
  await queueDriveUploadsSafe(svc, kind, [{ recordId, storeId }])
}

/** Read every row of a query, 1000 at a time (PostgREST returns at most 1000 per call by default). */
export async function selectAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export interface BackfillCounts {
  total: number       // records created on/after the backfill date (delivery orders: acknowledged only)
  alreadyDone: number // already in Drive, left alone
  queued: number
  skippedTest: number
}

/**
 * Queue every acknowledged DO and every invoice created on/after 1 Nov 2026
 * (MYT) that is not already done in Drive. Done rows are not touched; pending
 * and failed rows are reset to pending.
 */
export async function backfillDriveUploads(
  svc: SupabaseClient,
): Promise<{ delivery_orders: BackfillCounts; invoices: BackfillCounts }> {
  return {
    delivery_orders: await backfillKind(svc, 'delivery_order', 'delivery_orders', 'acknowledged'),
    invoices: await backfillKind(svc, 'invoice', 'commission_periods', null),
  }
}

async function backfillKind(
  svc: SupabaseClient,
  kind: DriveKind,
  table: 'delivery_orders' | 'commission_periods',
  onlyStatus: string | null,
): Promise<BackfillCounts> {
  const records = await selectAll<{ id: string; store_id: string }>((from, to) => {
    const base = svc.from(table).select('id, store_id').gte('created_at', BACKFILL_FROM_ISO)
    const filtered = onlyStatus ? base.eq('status', onlyStatus) : base
    return filtered.order('id', { ascending: true }).range(from, to)
  })

  const done = await selectAll<{ record_id: string }>((from, to) =>
    svc
      .from('drive_uploads')
      .select('record_id')
      .eq('kind', kind)
      .eq('status', 'done')
      .order('record_id', { ascending: true })
      .range(from, to),
  )
  const doneIds = new Set(done.map((d) => d.record_id))

  const toQueue = records
    .filter((r) => !doneIds.has(r.id))
    .map((r) => ({ recordId: r.id, storeId: r.store_id }))

  const queued = await queueDriveUploads(svc, kind, toQueue)
  return {
    total: records.length,
    alreadyDone: records.filter((r) => doneIds.has(r.id)).length,
    queued: queued.queued,
    skippedTest: queued.skippedTest,
  }
}
