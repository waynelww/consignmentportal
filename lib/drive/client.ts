// Browser-side helpers for the Drive status shown to admins. Reads go straight
// to drive_uploads (RLS: admins only); queueing goes through /api/drive/requeue.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DriveKind } from './layout'

export interface DriveRow {
  record_id: string
  status: 'pending' | 'done' | 'failed'
  attempts: number
  last_error: string | null
  drive_url: string | null
}

/** Status rows for a set of records, keyed by record id. Missing id = never queued. */
export async function fetchDriveRows(
  db: SupabaseClient,
  kind: DriveKind,
  ids: string[],
): Promise<Map<string, DriveRow>> {
  const map = new Map<string, DriveRow>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('drive_uploads')
      .select('record_id, status, attempts, last_error, drive_url')
      .eq('kind', kind)
      .in('record_id', ids.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as DriveRow[]) map.set(row.record_id, row)
  }
  return map
}

/** Queue (or re-queue / retry) records. Returns an error message instead of throwing. */
export async function requeueDrive(kind: DriveKind, ids: string[]): Promise<{ ok: boolean; error?: string; queued?: number }> {
  try {
    const res = await fetch('/api/drive/requeue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ids }),
    })
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? `HTTP ${res.status}` }
    return { ok: true, queued: (data as { queued?: number }).queued }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}
