import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const UpdateSchema = z.object({
  label: z.string().min(1).max(60).optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return { error: 'Forbidden: admin only', status: 403 as const }
  }
  return { user }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const check = await requireAdmin(supabase)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const body = await request.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation', details: parsed.error.flatten() }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('store_types')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ store_type: data })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const check = await requireAdmin(supabase)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const adminClient = createAdminClient()

  // Look up the value first so we can check if any stores use it
  const { data: typeRow } = await adminClient
    .from('store_types')
    .select('value')
    .eq('id', id)
    .single()

  if (!typeRow) return Response.json({ error: 'Not found' }, { status: 404 })

  const { count: usageCount } = await adminClient
    .from('stores')
    .select('id', { count: 'exact', head: true })
    .eq('store_type', typeRow.value)

  if ((usageCount ?? 0) > 0) {
    // Soft delete — keep the row so historical stores still resolve their label
    const { error } = await adminClient
      .from('store_types')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({
      success: true,
      soft_deleted: true,
      reason: `${usageCount} store(s) use this type — deactivated instead of deleted so their type label keeps resolving.`,
    })
  }

  // Hard delete — no stores reference it
  const { error } = await adminClient.from('store_types').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true, soft_deleted: false })
}
