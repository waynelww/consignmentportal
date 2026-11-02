// What one save on a checklist cell writes to followup_log. Pure, so the API
// route and scripts/test-followups.ts share one rule.
//
// Every log row is a full snapshot of the cell (ticked and note after the
// change). That means the newest row is the cell's current state, and the
// history reads straight down.

export interface CellPrevious {
  ticked: boolean
  note: string | null
}

export interface EntryRequest {
  /** Omit to leave the box as it is. Not allowed on XCMS boxes. */
  ticked?: boolean
  /** Omit to leave the note as it is. Empty or blank clears it. */
  note?: string | null
}

export type EntryPlan =
  | { ok: true; action: 'tick' | 'untick' | 'note'; ticked: boolean | null; note: string | null }
  | { ok: false; error: string }

export const NOTE_MAX_LENGTH = 500

/** Trims a note; blank becomes null (no note). */
export function normaliseNote(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * @param auto  true for an XCMS store's box (only the note can change)
 * @param prev  the cell's newest log row, or null if it has none yet
 */
export function planEntry(args: { auto: boolean; prev: CellPrevious | null; request: EntryRequest }): EntryPlan {
  const { auto, prev, request } = args
  const prevTicked = prev?.ticked ?? false
  const prevNote = prev?.note ?? null
  const note = request.note !== undefined ? normaliseNote(request.note) : prevNote
  const noteChanged = note !== prevNote

  if (auto) {
    if (request.ticked !== undefined) {
      return { ok: false, error: 'This box is ticked automatically from XCMS. You can add a note, but not tick it.' }
    }
    if (!noteChanged) return { ok: false, error: 'Nothing changed' }
    return { ok: true, action: 'note', ticked: null, note }
  }

  const ticked = request.ticked ?? prevTicked
  const tickChanged = ticked !== prevTicked
  if (!tickChanged && !noteChanged) return { ok: false, error: 'Nothing changed' }

  const action = tickChanged ? (ticked ? 'tick' : 'untick') : 'note'
  return { ok: true, action, ticked, note }
}
