import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseStoreStaff, STAFF_NAME_DUPLICATE } from '@/lib/store-staff/access'

const NameSchema = z.string().trim().min(1, 'Name is required').max(60, 'Name must be 60 characters or fewer')

/**
 * GET  /api/store-staff?store_id=…[&include_hidden=1] — the store's staff, A–Z.
 * POST /api/store-staff  { store_id, name }          — add a staff member.
 */
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('store_id')
  if (!storeId) return Response.json({ error: 'store_id is required' }, { status: 400 })

  const auth = await authoriseStoreStaff(storeId)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const includeHidden = request.nextUrl.searchParams.get('include_hidden') === '1'
  const supabase = await createClient()
  let query = supabase
    .from('store_staff')
    .select('id, store_id, name, active, created_at')
    .eq('store_id', storeId)
    .order('name', { ascending: true })
  if (!includeHidden) query = query.eq('active', true)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ staff: data ?? [] })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = z.object({ store_id: z.string().uuid(), name: NameSchema }).safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }

  const { store_id, name } = parsed.data
  const auth = await authoriseStoreStaff(store_id)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { data, error } = await createAdminClient()
    .from('store_staff')
    .insert({ store_id, name })
    .select('id, store_id, name, active, created_at')
    .single()

  if (error?.code === '23505') return Response.json({ error: STAFF_NAME_DUPLICATE }, { status: 409 })
  if (error?.code === '23503') return Response.json({ error: 'Store not found' }, { status: 404 })
  if (error || !data) return Response.json({ error: 'Failed to add staff member', details: error?.message }, { status: 500 })

  return Response.json({ staff: data }, { status: 201 })
}
