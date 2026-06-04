import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const CreateSchema = z.object({
  store_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  code: z.string().max(40).optional().nullable(),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number().positive(),
  min_quantity: z.number().int().min(0).optional().default(0),
  min_amount: z.number().min(0).optional().default(0),
  is_active: z.boolean().optional().default(true),
  expires_at: z.string().optional().nullable(),
})

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const storeId = request.nextUrl.searchParams.get('store_id')
  if (!storeId) return Response.json({ error: 'store_id required' }, { status: 400 })

  // Authorization check
  const { data: profile } = await supabase.from('profiles').select('role, store_id').eq('id', user.id).single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role === 'store_owner' && profile.store_id !== storeId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('store_promos')
    .select('*')
    .eq('store_id', storeId)
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
  if (profile.role === 'store_owner' && profile.store_id !== parsed.data.store_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Percentage discount must be ≤ 100
  if (parsed.data.discount_type === 'percentage' && parsed.data.discount_value > 100) {
    return Response.json({ error: 'Percentage cannot exceed 100' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('store_promos')
    .insert({
      ...parsed.data,
      code: parsed.data.code?.trim() || null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ promo: data })
}
