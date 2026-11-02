'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X } from 'lucide-react'
import { FOLLOWUP_ITEM_LABELS, mytStamp, type FollowupItem, type RowView } from '@/lib/followups/build'
import { NOTE_MAX_LENGTH } from '@/lib/followups/entry'
import { formatMYDate } from '@/lib/utils'
import { saveFollowupEntry } from './save'

/** One checklist cell: its state, the note, and every change made by hand. */
export function CellDialog({
  row,
  item,
  month,
  workingAs,
  onClose,
  onChanged,
}: {
  row: RowView
  item: FollowupItem
  month: string
  workingAs: string
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const cell = row.cells[item]
  const [note, setNote] = useState(cell.note ?? '')
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>, ok: string) {
    if (!workingAs) { toast.error('Pick who you are under "Working as" first'); return }
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      await onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const toggle = () => run(
    () => saveFollowupEntry({ month, row, item, byMemberId: workingAs, ticked: !cell.done }),
    cell.done ? 'Unticked' : 'Ticked',
  )

  const saveNote = () => {
    const trimmed = note.trim()
    if (trimmed === (cell.note ?? '')) { toast.info('The note is unchanged'); return }
    return run(
      () => saveFollowupEntry({ month, row, item, byMemberId: workingAs, note: trimmed }),
      trimmed ? 'Note saved' : 'Note cleared',
    )
  }

  const newestFirst = [...cell.history].reverse()

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{row.name}</h2>
            <p className="text-sm text-gray-500">{FOLLOWUP_ITEM_LABELS[item]} · {month}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
        </div>

        {/* State */}
        <div className="rounded-lg border border-gray-200 p-3 text-sm space-y-2">
          {cell.auto ? (
            <>
              <p className="text-gray-700">
                Filled automatically from XCMS{cell.done ? '' : ' (not yet)'}.
                {cell.done && cell.auto_date && <> Done on <strong>{formatMYDate(cell.auto_date)}</strong>.</>}
              </p>
              {cell.auto_detail && <p className="text-gray-500">{cell.auto_detail}</p>}
            </>
          ) : (
            <>
              <p className="text-gray-700">{cell.done ? 'Ticked' : 'Not ticked yet'} (by hand)</p>
              <button
                type="button"
                onClick={toggle}
                disabled={busy || !workingAs}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {cell.done ? 'Untick' : 'Tick as done'}
              </button>
            </>
          )}
        </div>

        {/* Note */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor="followup-note">Note</label>
          <textarea
            id="followup-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            placeholder="e.g. store sent the receipt by WhatsApp, will pay on the 9th"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{note.length}/{NOTE_MAX_LENGTH}</span>
            <button
              type="button"
              onClick={saveNote}
              disabled={busy || !workingAs}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-[#0A0A0A] text-[#FFD700] disabled:opacity-50"
            >
              Save note
            </button>
          </div>
          {!workingAs && (
            <p className="text-xs text-amber-700">Pick who you are under &ldquo;Working as&rdquo; to save changes.</p>
          )}
        </div>

        {/* History */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">History</h3>
          {newestFirst.length === 0 ? (
            <p className="text-sm text-gray-400">No changes by hand yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {newestFirst.map((h) => (
                <li key={h.id} className="py-2">
                  <p className="text-gray-800">
                    <strong>{h.by_name ?? 'Unknown'}</strong>{' '}
                    {h.action === 'tick' && 'ticked this'}
                    {h.action === 'untick' && 'unticked this'}
                    {h.action === 'note' && 'changed the note'}
                    <span className="text-gray-400"> · {mytStamp(h.at)}</span>
                  </p>
                  {h.note && <p className="text-gray-500 text-xs mt-0.5 whitespace-pre-wrap">&ldquo;{h.note}&rdquo;</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
