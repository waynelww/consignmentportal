'use client'

import type { DriveRow } from '@/lib/drive/client'

// One line per DO / invoice, shown only to admins.
//   done    → "Open in Drive"
//   pending → "Drive: pending"
//   failed  → "Drive: failed — retry" (button)
//   none    → "Not in Drive" + Queue button (older record, or the queue step failed)
export default function DriveStatus({
  row,
  busy = false,
  onRetry,
}: {
  row: DriveRow | null | undefined
  busy?: boolean
  onRetry?: () => void
}) {
  const retry = onRetry && (
    <button
      type="button"
      onClick={onRetry}
      disabled={busy}
      className="text-xs font-medium text-blue-700 hover:underline disabled:opacity-50"
    >
      {busy ? 'Queuing…' : 'retry'}
    </button>
  )

  if (row?.status === 'done' && row.drive_url) {
    return (
      <a href={row.drive_url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-700 hover:underline">
        Open in Drive
      </a>
    )
  }
  if (row?.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-red-700" title={row.last_error ?? undefined}>
        Drive: failed — {retry}
      </span>
    )
  }
  if (row?.status === 'pending') {
    return <span className="text-xs text-amber-700">Drive: pending</span>
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-500">
      Not in Drive {onRetry && <button type="button" onClick={onRetry} disabled={busy} className="font-medium text-blue-700 hover:underline disabled:opacity-50">{busy ? 'Queuing…' : 'queue'}</button>}
    </span>
  )
}
