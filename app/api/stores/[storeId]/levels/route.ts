import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

// Stocked levels for a store's codes.
//   pairs_per_code      → the store's default level per code
//   clear_overrides     → drop every per-code override (true = "set all codes")
//   overrides           → per-code override: store_inventory id + level, or null to clear
// Plan stores (on_stock_plan) use plan levels, so per-code overrides are refused there.

const BodySchema = z.object({
  pairs_per_code: z.number().int().min(1).max(999).optional(),
  clear_overrides: z.boolean().optional(),
  overrides: z.array(z.object({
    id: z.string().uuid(),
    level: z.number().int().min(0).max(999).nullable(),
  })).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }
  const { pairs_per_code, clear_overrides, overrides } = parsed.data

  const { data: store, error: storeErr } = await supabase
    .from('stores').select('id, on_stock_plan').eq('id', storeId).single()
  if (storeErr || !store) return Response.json({ error: 'Store not found' }, { status: 404 })

  if (overrides?.length && store.on_stock_plan) {
    return Response.json({ error: 'This store is on the 4-month plan; its levels are set by the plan.' }, { status: 409 })
  }

  if (pairs_per_code !== undefined) {
    const { error } = await supabase.from('stores').update({ pairs_per_code, updated_at: new Date().toISOString() }).eq('id', storeId)
    if (error) return Response.json({ error: 'Failed to set pairs per code', details: error.message }, { status: 500 })
  }

  if (clear_overrides) {
    const { error } = await supabase.from('store_inventory')
      .update({ stocked_level: null, stocked_level_source: null })
      .eq('store_id', storeId)
      .not('stocked_level', 'is', null)
    if (error) return Response.json({ error: 'Failed to clear overrides', details: error.message }, { status: 500 })
  }

  for (const o of overrides ?? []) {
    const { error } = await supabase.from('store_inventory')
      .update(o.level === null
        ? { stocked_level: null, stocked_level_source: null }
        : { stocked_level: o.level, stocked_level_source: 'manual' })
      .eq('id', o.id)
      .eq('store_id', storeId)
    if (error) return Response.json({ error: 'Failed to save override', details: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
