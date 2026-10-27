import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRestockCalcAccess } from '@/lib/restock/wayne-api'
import type { SkuResult } from '@/lib/restock/wayne-calc'

// PATCH /api/restock/calculator/[calcId]
// { edited_sends?: { product_id: qty }, restock_request_id?: uuid }
// Only the Send overrides and the linked restock request can change; the
// calculated results are frozen (enforced again by a DB trigger).
const PatchSchema = z.object({
  edited_sends: z.record(z.string().uuid(), z.number().int().min(0).max(100000)).optional(),
  restock_request_id: z.string().uuid().optional(),
}).refine((b) => b.edited_sends !== undefined || b.restock_request_id !== undefined, 'Nothing to update')

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ calcId: string }> }
) {
  const { calcId } = await params
  const access = await requireRestockCalcAccess()
  if ('error' in access) return access.error
  const { supabase, user } = access

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: calc, error: calcErr } = await supabase
    .from('restock_calculations')
    .select('id, store_id, sku_results, edited_sends, restock_request_id, voided_at')
    .eq('id', calcId)
    .single()
  if (calcErr || !calc) return Response.json({ error: 'Calculation not found' }, { status: 404 })
  if (calc.voided_at) return Response.json({ error: 'This calculation is voided' }, { status: 400 })

  const update: Record<string, unknown> = {}

  if (parsed.data.edited_sends) {
    if (calc.restock_request_id) {
      return Response.json({ error: 'A restock request was already created from this calculation' }, { status: 400 })
    }
    const skus = (calc.sku_results ?? []) as SkuResult[]
    const known = new Map(skus.map((s) => [s.product_id, s.send]))
    const overrides: Record<string, number> = {}
    for (const [pid, qty] of Object.entries(parsed.data.edited_sends)) {
      if (!known.has(pid)) return Response.json({ error: `Product ${pid} is not in this calculation` }, { status: 400 })
      if (known.get(pid) !== qty) overrides[pid] = qty // keep only real edits
    }
    update.edited_sends = Object.keys(overrides).length ? overrides : null
    update.final_total = skus.reduce((a, s) => a + (overrides[s.product_id] ?? s.send), 0)
    update.edited_by = user.id
    update.edited_at = new Date().toISOString()
  }

  if (parsed.data.restock_request_id) {
    if (calc.restock_request_id) {
      return Response.json({ error: 'Already linked to a restock request' }, { status: 400 })
    }
    const { data: req } = await supabase
      .from('restock_requests')
      .select('id, store_id')
      .eq('id', parsed.data.restock_request_id)
      .single()
    if (!req || req.store_id !== calc.store_id) {
      return Response.json({ error: 'Restock request not found for this store' }, { status: 400 })
    }
    update.restock_request_id = req.id
  }

  const { data: saved, error } = await supabase
    .from('restock_calculations')
    .update(update)
    .eq('id', calcId)
    .select('*')
    .single()
  if (error || !saved) {
    return Response.json({ error: 'Failed to update calculation', details: error?.message }, { status: 500 })
  }
  return Response.json({ calculation: saved })
}
