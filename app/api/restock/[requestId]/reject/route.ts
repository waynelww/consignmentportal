import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const RejectSchema = z.object({
  admin_notes: z.string().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = RejectSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { admin_notes } = parsed.data

  const { data: restockRequest, error: reqErr } = await supabase
    .from('restock_requests')
    .select('id, store_id, status')
    .eq('id', requestId)
    .single()

  if (reqErr || !restockRequest) {
    return Response.json({ error: 'Restock request not found' }, { status: 404 })
  }
  if (restockRequest.status !== 'pending') {
    return Response.json({ error: `Cannot reject request with status: ${restockRequest.status}` }, { status: 400 })
  }

  const { error: updateErr } = await supabase
    .from('restock_requests')
    .update({
      status: 'rejected',
      admin_notes: admin_notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  if (updateErr) {
    return Response.json({ error: 'Failed to reject request', details: updateErr.message }, { status: 500 })
  }

  await supabase.from('notifications').insert({
    recipient_role: null,
    recipient_store_id: restockRequest.store_id,
    type: 'restock_request',
    title: 'Restock Request Rejected',
    message: admin_notes
      ? `Your restock request has been rejected. Reason: ${admin_notes}`
      : 'Your restock request has been rejected.',
    reference_id: requestId,
    reference_type: 'restock_request',
    is_read: false,
  })

  return Response.json({ success: true })
}
