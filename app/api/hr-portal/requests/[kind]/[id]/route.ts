import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { HR_BUCKET } from '@/lib/hr/access'
import { portalMember } from '@/lib/hr/portal-session'
import { logHr } from '@/lib/hr/audit'

const TABLE = { claim: 'hr_claims', leave: 'hr_leaves' } as const
const FILE_COLUMN = { claim: 'receipt_path', leave: 'attachment_path' } as const

/** DELETE /api/hr-portal/requests/[kind]/[id] — the person cancels their own request while it is still pending. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const svc = await createServiceClient()
  const me = await portalMember(request, svc)
  if (!me) return Response.json({ error: 'Signed out' }, { status: 401 })

  const { kind, id } = await params
  if (kind !== 'claim' && kind !== 'leave') return Response.json({ error: 'Unknown request kind' }, { status: 404 })

  const { data } = await svc.from(TABLE[kind]).select(`id, member_id, status, ${FILE_COLUMN[kind]}`).eq('id', id).maybeSingle()
  const row = data as unknown as Record<string, string | null> | null
  if (!row || row.member_id !== me.id) return Response.json({ error: 'Not found' }, { status: 404 })
  if (row.status !== 'pending') return Response.json({ error: 'Only pending requests can be cancelled' }, { status: 409 })

  const { error } = await svc.from(TABLE[kind]).delete().eq('id', id).eq('status', 'pending')
  if (error) return Response.json({ error: 'Cancel failed', details: error.message }, { status: 500 })
  const path = row[FILE_COLUMN[kind]]
  if (path) await svc.storage.from(HR_BUCKET).remove([path])
  await logHr(svc, request, { type: 'staff', memberId: me.id, label: me.name }, `${kind}.cancelled`, { type: kind, id })
  return Response.json({ ok: true })
}
