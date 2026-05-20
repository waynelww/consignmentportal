import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const UpdateStoreSchema = z.object({
  store_name: z.string().min(1).optional(),
  pic_name: z.string().min(1).optional(),
  pic_phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  postcode: z.string().min(1).optional(),
  store_type: z.enum([
    'barbershop', 'shoe_store', 'fashion_boutique', 'sports_store',
    'laundromat', 'gym', 'muslim_fashion', 'school_uniform',
    'pharmacy', 'optical', 'cafe', 'other',
  ]).optional(),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_account_name: z.string().optional(),
  commission_rate: z.number().min(0).max(100).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'pending']).optional(),
  notes: z.string().optional(),
  agreement_signed_at: z.string().optional(),
  agreement_signed_by: z.string().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params

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
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateStoreSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: 'No fields provided for update' }, { status: 400 })
  }

  const { data: updated, error: updateErr } = await supabase
    .from('stores')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', storeId)
    .select()
    .single()

  if (updateErr) {
    return Response.json({ error: 'Failed to update store', details: updateErr.message }, { status: 500 })
  }

  if (!updated) {
    return Response.json({ error: 'Store not found' }, { status: 404 })
  }

  return Response.json({ store: updated })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  if (profile.role === 'store_owner' && profile.store_id !== storeId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: store, error } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single()

  if (error || !store) {
    return Response.json({ error: 'Store not found' }, { status: 404 })
  }

  return Response.json({ store })
}
