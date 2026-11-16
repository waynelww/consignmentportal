'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

type Counts = { pending: number; done: number; failed: number }
interface FailedRow { kind: string; record_id: string; attempts: number; last_error: string | null }
interface RenameResponse {
  error?: string
  checked: number; renamed: number; missing: number; failed: number
  errors: { kind: string; record_id: string; message: string }[]
  finished: boolean; next_after: string | null
}
interface RenameTotals {
  checked: number; renamed: number; missing: number; failed: number
  errors: { kind: string; record_id: string; message: string }[]
}
interface BackfillResult {
  delivery_orders: { total: number; alreadyDone: number; queued: number; skippedTest: number }
  invoices: { total: number; alreadyDone: number; queued: number; skippedTest: number }
}

// Settings → General. Shows the Google Drive copy queue and lets admins
// queue the Nov 2026 backfill. Reads use the admin RLS policy on drive_uploads.
export default function DriveUploadsCard() {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [failed, setFailed] = useState<FailedRow[]>([])
  const [canBackfill, setCanBackfill] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BackfillResult | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameProgress, setRenameProgress] = useState<string | null>(null)
  const [renameResult, setRenameResult] = useState<RenameTotals | null>(null)

  const load = useCallback(async () => {
    const db = createClient()
    const count = async (status: 'pending' | 'done' | 'failed') => {
      const { count: n } = await db.from('drive_uploads').select('id', { count: 'exact', head: true }).eq('status', status)
      return n ?? 0
    }
    const [pending, done, failedN, recentFailed] = await Promise.all([
      count('pending'),
      count('done'),
      count('failed'),
      db.from('drive_uploads')
        .select('kind, record_id, attempts, last_error')
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(5),
    ])
    setCounts({ pending, done, failed: failedN })
    setFailed((recentFailed.data ?? []) as FailedRow[])
  }, [])

  useEffect(() => {
    load()
    const db = createClient()
    db.auth.getUser().then(async ({ data }: { data: { user: { id: string } | null } }) => {
      const user = data.user
      if (!user) return
      const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
      setCanBackfill(profile?.role === 'super_admin' || profile?.role === 'ops_manager')
    })
  }, [load])

  async function runBackfill() {
    if (!window.confirm('Queue every delivery order and invoice from 1 Nov 2026 that is not yet in Drive? Nothing before November is included.')) return
    setRunning(true)
    try {
      const res = await fetch('/api/drive/backfill', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Backfill failed'); return }
      setResult(data as BackfillResult)
      toast.success('Backfill queued — the worker uploads within 15 minutes')
      load()
    } catch {
      toast.error('Network error')
    } finally {
      setRunning(false)
    }
  }

  // One-off: rename existing Drive files to the current names. Renames only, in batches.
  async function runRename() {
    if (!window.confirm('Rename every Drive copy to the new file names? Only the names change. Nothing is re-uploaded and file contents are not touched.')) return
    setRenaming(true)
    setRenameResult(null)
    const totals: RenameTotals = { checked: 0, renamed: 0, missing: 0, failed: 0, errors: [] }
    let after: string | null = null
    try {
      for (let batch = 0; batch < 1000; batch++) {
        const res: Response = await fetch('/api/drive/rename-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ after }),
        })
        const data = (await res.json().catch(() => ({}))) as RenameResponse
        if (!res.ok) { toast.error(data.error ?? `Rename failed (HTTP ${res.status})`); break }
        totals.checked += data.checked
        totals.renamed += data.renamed
        totals.missing += data.missing
        totals.failed += data.failed
        totals.errors = [...totals.errors, ...data.errors].slice(0, 20)
        setRenameProgress(`${totals.renamed} renamed so far…`)
        if (data.finished) break
        after = data.next_after
      }
      setRenameResult(totals)
      if (totals.failed === 0) toast.success(`Renamed ${totals.renamed} Drive file${totals.renamed === 1 ? '' : 's'}`)
      else toast.error(`${totals.failed} failed — see the list`)
    } catch {
      toast.error('Network error — press the button again to continue')
    } finally {
      setRenaming(false)
      setRenameProgress(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Google Drive copies</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Delivery orders, monthly invoices and payment receipts are copied to the XCMS Shared Drive every 15 minutes.
          </p>
        </div>
        <button onClick={load} className="text-xs text-blue-700 hover:underline shrink-0">Refresh</button>
      </div>

      <p className="text-sm text-gray-800">
        {counts
          ? <>Drive uploads: <span className="font-medium text-amber-700">{counts.pending} pending</span> · <span className="font-medium text-green-700">{counts.done} done</span> · <span className="font-medium text-red-700">{counts.failed} failed</span></>
          : 'Loading…'}
      </p>

      {failed.length > 0 && (
        <div className="text-xs text-red-700 space-y-1">
          <p className="font-medium">Recent failures (retry from the DO or invoice row, or the backfill):</p>
          {failed.map((f) => (
            <p key={`${f.kind}-${f.record_id}`} className="font-mono break-all">
              {f.kind === 'invoice' ? 'Invoice' : f.kind === 'payment_receipt' ? 'Receipt' : 'DO'} {f.record_id.slice(0, 8)} · {f.attempts} attempts · {f.last_error ?? 'no message'}
            </p>
          ))}
        </div>
      )}

      {canBackfill && (
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <button
            onClick={runBackfill}
            disabled={running}
            className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {running ? 'Queuing…' : 'Queue Drive backfill'}
          </button>
          <p className="text-xs text-gray-500">Queues every DO and invoice from 1 Nov 2026 (non-test stores). Already-uploaded files are left alone.</p>
          {result && (
            <p className="text-xs text-gray-700">
              DOs: {result.delivery_orders.queued} queued, {result.delivery_orders.alreadyDone} already in Drive, {result.delivery_orders.skippedTest} test. ·
              {' '}Invoices: {result.invoices.queued} queued, {result.invoices.alreadyDone} already in Drive, {result.invoices.skippedTest} test.
            </p>
          )}
        </div>
      )}

      {canBackfill && (
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <button
            onClick={runRename}
            disabled={renaming}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-900 text-gray-900 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {renaming ? (renameProgress ?? 'Renaming…') : 'Rename Drive files to new names'}
          </button>
          <p className="text-xs text-gray-500">
            One-off. Renames every done Drive copy in place to the current name format (DOs, invoices and receipts). No re-upload, no content change.
          </p>
          {renameResult && (
            <div className="text-xs text-gray-700 space-y-1">
              <p>
                Checked {renameResult.checked} · <span className="font-medium text-green-700">renamed {renameResult.renamed}</span>
                {' '}· missing in Drive {renameResult.missing} · <span className="font-medium text-red-700">failed {renameResult.failed}</span>
              </p>
              {renameResult.errors.map((e, i) => (
                <p key={i} className="font-mono break-all text-red-700">
                  {e.kind} {e.record_id.slice(0, 8)} · {e.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
