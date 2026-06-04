import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const UpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  code: z.string().max(40).nullable().optional(),
  discount_type: z.enum(['percentage', 'fixed']).optional(),
  discount_value: z.number().positive().optional(),
  min_quantity: z.number().int().min(0).optional(),
  min_amount: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
})

async function checkAuth(supabase: Awaited<ReturnType<typeof createClient>>, promoId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase.from('profiles').select('role, store_id').eq('id', user.id).single()
  if (!profile) return { error: 'Profile not found', status: 403 as const }
  const { data: promo } = await supabase.from('store_promos').select('store_id').eq('id', promoId).single()
  if (!promo) return { error: 'Promo not found', status: 404 as const }
  if (profile.role === 'store_owner' && profile.store_id !== promo.store_id) {
    return { error: 'Forbidden', status: 403 as const }
  }
  return { promo }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params
  const supabase = await createClient()
  const check = await checkAuth(supabase, promoId)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const body = await request.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Validation', details: parsed.error.flatten() }, { status: 400 })

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('store_promos')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', promoId)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ promo: data })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params
  const supabase = await createClient()
  const check = await checkAuth(supabase, promoId)
  if ('error' in check) return Response.json({ error: check.error }, { status: check.status })

  const adminClient = createAdminClient()
  // Soft delete: just mark inactive so historical sales keep their promo_id reference
  const { error } = await adminClient
    .from('store_promos')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', promoId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
