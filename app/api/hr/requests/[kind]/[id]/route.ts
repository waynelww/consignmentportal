import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { logHr } from '@/lib/hr/audit'
import { copyToDrive, driveStatus } from '@/lib/hr/drive'

type Kind = 'claim' | 'leave' | 'work'
const TABLE: Record<Kind, string> = { claim: 'hr_claims', leave: 'hr_leaves', work: 'hr_rest_day_work' }

function kindOf(raw: string): Kind | null {
  return raw === 'claim' || raw === 'leave' || raw === 'work' ? raw : null
}

const ReviewSchema = z.object({
  action: z.enum(['approve', 'reject', 'paid']),
  note: z.string().trim().max(300).nullish(),
})

/**
 * PATCH /api/hr/requests/[kind]/[id] { action, note } — HR admin only.
 *   approve: pending → approved   reject: pending|approved → rejected
 *   paid (claims only): approved → paid
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { kind: rawKind, id } = await params
  const kind = kindOf(rawKind)
  if (!kind) return Response.json({ error: 'Unknown request kind' }, { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = ReviewSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  const { action, note } = parsed.data

  const svc = await createServiceClient()
  const { data: row } = await svc.from(TABLE[kind]).select('id, status, member_id').eq('id', id).maybeSingle()
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  let patch: Record<string, unknown>
  if (action === 'approve' && row.status === 'pending') {
    patch = { status: 'approved', reviewed_at: now, review_note: note || null }
  } else if (action === 'reject' && (row.status === 'pending' || row.status === 'approved')) {
    patch = { status: 'rejected', reviewed_at: now, review_note: note || null }
  } else if (action === 'paid' && kind === 'claim' && row.status === 'approved') {
    patch = { status: 'paid', paid_at: now }
  } else {
    return Response.json({ error: `Cannot ${action} a request that is ${row.status}` }, { status: 409 })
  }

  const { error } = await svc.from(TABLE[kind]).update(patch).eq('id', id).eq('status', row.status)
  if (error) return Response.json({ error: 'Update failed', details: error.message }, { status: 500 })
  const done = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'paid'
  await logHr(svc, request, { type: 'admin', label: auth.label }, `${kind}.${done}`, { type: kind, id },
    { for_member_id: row.member_id, from_status: row.status, note: note || null })

  // On approval, copy the receipt / MC slip to Google Drive if connected. A
  // failure never undoes the approval; "Copy now" in settings retries later.
  let drive: string | null = null
  if (action === 'approve' && kind !== 'work' && (await driveStatus(svc)).connected) {
    try {
      drive = (await copyToDrive(svc, kind, id)) ? 'copied' : null
    } catch (err) {
      console.error('[hr drive] copy on approve failed:', err)
      drive = 'failed'
    }
  }
  return Response.json({ ok: true, drive })
}
