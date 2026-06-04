import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const CreateSchema = z.object({
  value: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'value must be lowercase letters, numbers, and underscores'),
  label: z.string().min(1).max(60),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const onlyActive = request.nextUrl.searchParams.get('active') === '1'

  let query = supabase
    .from('store_types')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (onlyActive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ store_types: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation', details: parsed.error.flatten() }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('store_types')
    .insert({
      value: parsed.data.value.toLowerCase().trim(),
      label: parsed.data.label.trim(),
      sort_order: parsed.data.sort_order ?? 500,
      is_active: parsed.data.is_active ?? true,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: 'A type with this value already exists' }, { status: 409 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ store_type: data })
}
