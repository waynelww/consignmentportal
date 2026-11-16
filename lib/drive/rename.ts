// One-off rename of Drive copies that were uploaded under the older names.
// Works through done drive_uploads rows in id order, in batches, and changes the
// name of each file in place via its drive_file_id (files.update name only). No
// content is read or re-uploaded. Called repeatedly by the admin button in
// Settings → General until finished (each call stays inside the 60s limit).
//
// Names come from lib/drive/layout.ts, the same rules the uploads use, so a file
// renamed here matches what a re-upload would produce.

import type { SupabaseClient } from '@supabase/supabase-js'
import { renameDriveFile } from '@/lib/google/drive'
import { doFileName, invoiceFileName, receiptFileName, type DriveKind } from './layout'

export const RENAME_BUDGET_MS = 40_000
const BATCH = 100

export interface RenameError {
  kind: DriveKind
  record_id: string
  message: string
}

export interface RenameBatchResult {
  checked: number       // done rows read in this call
  renamed: number       // name changed in Drive
  missing: number       // Drive file no longer exists: nothing to rename
  failed: number        // Drive or lookup error: left as it was
  errors: RenameError[] // first 20 failures
  next_after: string | null // pass back as `after` to continue
  finished: boolean
  elapsed_ms: number
}

interface DoneRow {
  id: string
  kind: DriveKind
  record_id: string
  drive_file_id: string
}

type StoreRef = { store_name: string } | { store_name: string }[] | null
function storeNameOf(ref: StoreRef): string | null {
  if (!ref) return null
  const one = Array.isArray(ref) ? ref[0] : ref
  return one?.store_name ?? null
}

/** Desired Drive file name per record id, or an error message for that record. */
async function desiredNames(
  svc: SupabaseClient,
  kind: DriveKind,
  ids: string[],
): Promise<Map<string, string | { error: string }>> {
  const out = new Map<string, string | { error: string }>()
  if (ids.length === 0) return out

  if (kind === 'invoice') {
    const { data, error } = await svc
      .from('commission_periods')
      .select('id, period_month, period_year, stores:store_id(store_name)')
      .in('id', ids)
    if (error) throw new Error(`Could not read invoices: ${error.message}`)
    for (const row of data ?? []) {
      const store = storeNameOf(row.stores as unknown as StoreRef)
      if (!store) { out.set(row.id as string, { error: 'store not found' }); continue }
      out.set(row.id as string, invoiceFileName(store, row.period_month as number, row.period_year as number))
    }
  } else if (kind === 'delivery_order') {
    const { data, error } = await svc
      .from('delivery_orders')
      .select('id, do_number, created_at, stores:store_id(store_name)')
      .in('id', ids)
    if (error) throw new Error(`Could not read delivery orders: ${error.message}`)
    for (const row of data ?? []) {
      const store = storeNameOf(row.stores as unknown as StoreRef)
      if (!store) { out.set(row.id as string, { error: 'store not found' }); continue }
      out.set(row.id as string, doFileName(store, row.do_number as string, row.created_at as string))
    }
  } else {
    // Payment receipts: name from the receipt's invoice period and its stored type.
    const { data: receipts, error } = await svc
      .from('payment_receipts')
      .select('id, mime_type, commission_period_id, stores:store_id(store_name)')
      .in('id', ids)
    if (error) throw new Error(`Could not read receipts: ${error.message}`)
    const periodIds = [...new Set((receipts ?? []).map((r) => r.commission_period_id as string))]
    const { data: periods, error: pErr } = await svc
      .from('commission_periods')
      .select('id, period_month, period_year')
      .in('id', periodIds.length ? periodIds : ['00000000-0000-0000-0000-000000000000'])
    if (pErr) throw new Error(`Could not read invoices: ${pErr.message}`)
    const periodById = new Map((periods ?? []).map((p) => [p.id as string, p]))
    for (const r of receipts ?? []) {
      const store = storeNameOf(r.stores as unknown as StoreRef)
      const period = periodById.get(r.commission_period_id as string)
      if (!store || !period) { out.set(r.id as string, { error: 'store or invoice not found' }); continue }
      if (!r.mime_type) { out.set(r.id as string, { error: 'receipt has no stored type' }); continue }
      try {
        out.set(r.id as string, receiptFileName(
          store, period.period_month as number, period.period_year as number, r.mime_type as string,
        ))
      } catch (err) {
        out.set(r.id as string, { error: err instanceof Error ? err.message : 'bad receipt type' })
      }
    }
  }
  return out
}

/**
 * Rename up to one batch of done Drive copies, starting after `after` (a
 * drive_uploads id), stopping early when the time budget is used up.
 */
export async function renameDoneDriveFilesBatch(
  svc: SupabaseClient,
  options: { after?: string | null; budgetMs?: number } = {},
): Promise<RenameBatchResult> {
  const started = Date.now()
  const budgetMs = options.budgetMs ?? RENAME_BUDGET_MS
  const result: RenameBatchResult = {
    checked: 0, renamed: 0, missing: 0, failed: 0, errors: [],
    next_after: options.after ?? null, finished: false, elapsed_ms: 0,
  }

  let query = svc
    .from('drive_uploads')
    .select('id, kind, record_id, drive_file_id')
    .eq('status', 'done')
    .not('drive_file_id', 'is', null)
    .order('id', { ascending: true })
    .limit(BATCH)
  if (options.after) query = query.gt('id', options.after)
  const { data, error } = await query
  if (error) throw new Error(`Could not read Drive copies: ${error.message}`)
  const rows = (data ?? []) as DoneRow[]

  // Look up the new names kind by kind, in one query each.
  const names = new Map<string, Map<string, string | { error: string }>>()
  for (const kind of ['invoice', 'delivery_order', 'payment_receipt'] as DriveKind[]) {
    const ids = rows.filter((r) => r.kind === kind).map((r) => r.record_id)
    names.set(kind, await desiredNames(svc, kind, ids))
  }

  let processedAll = true
  for (const row of rows) {
    if (Date.now() - started > budgetMs) { processedAll = false; break }
    result.checked++
    result.next_after = row.id

    const wanted = names.get(row.kind)?.get(row.record_id)
    if (!wanted || typeof wanted !== 'string') {
      result.failed++
      if (result.errors.length < 20) {
        result.errors.push({
          kind: row.kind,
          record_id: row.record_id,
          message: typeof wanted === 'object' ? wanted.error : 'record not found',
        })
      }
      continue
    }

    try {
      const exists = await renameDriveFile(row.drive_file_id, wanted)
      if (exists) result.renamed++
      else result.missing++
    } catch (err) {
      result.failed++
      if (result.errors.length < 20) {
        result.errors.push({
          kind: row.kind,
          record_id: row.record_id,
          message: (err instanceof Error ? err.message : 'rename failed').slice(0, 300),
        })
      }
    }
  }

  result.finished = processedAll && rows.length < BATCH
  result.elapsed_ms = Date.now() - started
  return result
}
