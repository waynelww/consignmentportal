import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { logHr } from '@/lib/hr/audit'
import { copyToDrive, disconnectDrive, driveStatus, driveTest, pendingDriveCopies } from '@/lib/hr/drive'

export const maxDuration = 60

/** GET /api/hr/drive — Drive connection status and how many approved files are not copied yet. */
export async function GET() {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const db = await createServiceClient()
  const [status, pending] = await Promise.all([driveStatus(db), pendingDriveCopies(db, 200)])
  return Response.json({ ...status, pending: pending.length })
}

/**
 * POST /api/hr/drive — copy approved files that are not in Drive yet, up to 8
 * per call (Vercel's 60s limit). The page calls again while `remaining` > 0.
 */
export async function POST(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const db = await createServiceClient()
  if (!(await driveStatus(db)).connected) return Response.json({ error: 'Connect Google Drive first' }, { status: 400 })

  const batch = (await pendingDriveCopies(db, 8)).slice(0, 8)
  let copied = 0
  const errors: string[] = []
  for (const item of batch) {
    try {
      if (await copyToDrive(db, item.kind, item.id)) copied++
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (copied > 0) await logHr(db, request, { type: 'admin', label: auth.label }, 'drive.copied', null, { count: copied })
  const remaining = (await pendingDriveCopies(db, 200)).length
  // Stop the page's loop if nothing in this batch worked.
  return Response.json({ copied, remaining, errors, stuck: batch.length > 0 && copied === 0 })
}

/** PUT /api/hr/drive — "Test": creates the folder and a note in it, returns the folder link. */
export async function PUT(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const db = await createServiceClient()
  if (!(await driveStatus(db)).connected) return Response.json({ error: 'Connect Google Drive first' }, { status: 400 })
  try {
    const folder = await driveTest(db)
    await logHr(db, request, { type: 'admin', label: auth.label }, 'drive.tested', null, { folder })
    return Response.json({ ok: true, folder })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** DELETE /api/hr/drive — disconnect. Files already in Drive stay there. */
export async function DELETE(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const db = await createServiceClient()
  await disconnectDrive(db)
  await logHr(db, request, { type: 'admin', label: auth.label }, 'drive.disconnected')
  return Response.json({ ok: true })
}
