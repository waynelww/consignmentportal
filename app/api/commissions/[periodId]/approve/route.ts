import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ periodId: string }> }
) {
  const { periodId } = await params

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
    return Response.json({ error: 'Forbidden: super_admin or ops_manager only' }, { status: 403 })
  }

  const { data: period, error: periodErr } = await supabase
    .from('commission_periods')
    .select('id, status')
    .eq('id', periodId)
    .single()

  if (periodErr || !period) {
    return Response.json({ error: 'Commission period not found' }, { status: 404 })
  }
  if (period.status !== 'pending') {
    return Response.json({ error: `Cannot approve period with status: ${period.status}` }, { status: 400 })
  }

  const { error: updateErr } = await supabase
    .from('commission_periods')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', periodId)

  if (updateErr) {
    return Response.json({ error: 'Failed to approve commission period', details: updateErr.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
