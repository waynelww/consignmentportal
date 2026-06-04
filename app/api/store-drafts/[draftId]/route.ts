import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return { error: 'Forbidden: admin only', status: 403 as const }
  }
  return { user }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params
  const supabase = await createClient()
  const check = await requireAdmin(supabase)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const { data, error } = await supabase
    .from('store_drafts')
    .select('*')
    .eq('id', draftId)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 404 })
  return Response.json({ draft: data })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params
  const supabase = await createClient()
  const check = await requireAdmin(supabase)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const body = await request.json().catch(() => ({}))
  const data = (body?.data ?? null) as Record<string, unknown> | null
  if (!data) return Response.json({ error: 'data required' }, { status: 400 })

  const title =
    (typeof data.store_name === 'string' && data.store_name.trim()) ||
    (typeof data.pic_name === 'string' && data.pic_name.trim()) ||
    'Untitled draft'

  const adminClient = createAdminClient()
  const { data: row, error } = await adminClient
    .from('store_drafts')
    .update({ data, title, updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ draft: row })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params
  const supabase = await createClient()
  const check = await requireAdmin(supabase)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const adminClient = createAdminClient()
  const { error } = await adminClient.from('store_drafts').delete().eq('id', draftId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
