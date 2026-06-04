import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const CreateSchema = z.object({
  // Omit or set null for a global (admin-only) promo
  store_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(80),
  code: z.string().max(40).optional().nullable(),
  discount_type: z.enum(['percentage', 'fixed', 'bxgy']),
  discount_value: z.number().min(0).nullable().optional(),
  min_quantity: z.number().int().min(0).optional().default(0),
  min_amount: z.number().min(0).optional().default(0),
  buy_quantity: z.number().int().positive().nullable().optional(),
  free_quantity: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional().default(true),
  expires_at: z.string().optional().nullable(),
})

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const storeId = request.nextUrl.searchParams.get('store_id')
  // Special scope=admin lets admins fetch ONLY global promos (store_id IS NULL)
  const scope = request.nextUrl.searchParams.get('scope')

  const { data: profile } = await supabase.from('profiles').select('role, store_id').eq('id', user.id).single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  const isAdmin = profile.role === 'super_admin' || profile.role === 'ops_manager'

  let query = supabase.from('store_promos').select('*')

  if (scope === 'global') {
    // Admin pulling the global list
    if (!isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 })
    query = query.is('store_id', null)
  } else if (storeId) {
    // Store-scoped view: own promos + globals
    if (profile.role === 'store_owner' && profile.store_id !== storeId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Postgrest: store_id.eq.X OR store_id.is.null
    query = query.or(`store_id.eq.${storeId},store_id.is.null`)
  } else {
    return Response.json({ error: 'store_id or scope required' }, { status: 400 })
  }

  const { data, error } = await query
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ promos: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Validation', details: parsed.error.flatten() }, { status: 400 })

  const { data: profile } = await supabase.from('profiles').select('role, store_id').eq('id', user.id).single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  const isAdmin = profile.role === 'super_admin' || profile.role === 'ops_manager'
  const targetStoreId = parsed.data.store_id ?? null

  if (targetStoreId === null) {
    // Global promo — admin only
    if (!isAdmin) return Response.json({ error: 'Only admins can create global promos' }, { status: 403 })
  } else if (profile.role === 'store_owner' && profile.store_id !== targetStoreId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Type-specific validation
  if (parsed.data.discount_type === 'percentage') {
    if (parsed.data.discount_value == null || parsed.data.discount_value <= 0) {
      return Response.json({ error: 'Percentage value required' }, { status: 400 })
    }
    if (parsed.data.discount_value > 100) {
      return Response.json({ error: 'Percentage cannot exceed 100' }, { status: 400 })
    }
  } else if (parsed.data.discount_type === 'fixed') {
    if (parsed.data.discount_value == null || parsed.data.discount_value <= 0) {
      return Response.json({ error: 'Fixed amount required' }, { status: 400 })
    }
  } else if (parsed.data.discount_type === 'bxgy') {
    if (!parsed.data.buy_quantity || !parsed.data.free_quantity) {
      return Response.json({ error: 'Buy/free quantities required for BXGY' }, { status: 400 })
    }
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('store_promos')
    .insert({
      ...parsed.data,
      store_id: targetStoreId,
      code: parsed.data.code?.trim() || null,
      discount_value: parsed.data.discount_value ?? 0,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ promo: data })
}
