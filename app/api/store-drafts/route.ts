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

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const check = await requireAdmin(supabase)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const { data, error } = await supabase
    .from('store_drafts')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ drafts: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const check = await requireAdmin(supabase)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const body = await request.json().catch(() => ({}))
  const data = (body?.data ?? {}) as Record<string, unknown>
  // Derive a friendly title from the data so the list is readable
  const title =
    (typeof data.store_name === 'string' && data.store_name.trim()) ||
    (typeof data.pic_name === 'string' && data.pic_name.trim()) ||
    'Untitled draft'

  const adminClient = createAdminClient()
  const { data: row, error } = await adminClient
    .from('store_drafts')
    .insert({
      created_by: check.user.id,
      title,
      data,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ draft: row })
}
