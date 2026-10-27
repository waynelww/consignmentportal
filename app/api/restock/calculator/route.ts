import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRestockCalcAccess, runWayneCalc, toCalcRow } from '@/lib/restock/wayne-api'
import { isValidMonth } from '@/lib/restock/wayne-calc'

// Restock Calculator (Wayne's method). super_admin + ops_manager only.
// GET  ?end_month=YYYY-MM[&store_id=]  → overview for active stores (not saved)
// POST { store_id, end_month }         → recalculates server-side and saves
//                                        the result to restock_calculations
export async function GET(request: NextRequest) {
  const access = await requireRestockCalcAccess()
  if ('error' in access) return access.error

  const { searchParams } = new URL(request.url)
  const endMonth = searchParams.get('end_month')
  const storeId = searchParams.get('store_id')
  if (endMonth && !isValidMonth(endMonth)) {
    return Response.json({ error: 'end_month must be YYYY-MM' }, { status: 400 })
  }

  try {
    const run = await runWayneCalc({ endMonth, storeIds: storeId ? [storeId] : undefined })
    return Response.json(run)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Calculation failed' }, { status: 500 })
  }
}

const SaveSchema = z.object({
  store_id: z.string().uuid(),
  end_month: z.string().refine(isValidMonth, 'end_month must be YYYY-MM'),
})

export async function POST(request: NextRequest) {
  const access = await requireRestockCalcAccess()
  if ('error' in access) return access.error
  const { supabase, user, profile } = access

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = SaveSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  let run
  try {
    run = await runWayneCalc({ endMonth: parsed.data.end_month, storeIds: [parsed.data.store_id] })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Calculation failed' }, { status: 500 })
  }
  const result = run.stores[0]
  if (!result) return Response.json({ error: 'Store not found or not active' }, { status: 404 })

  const { data: saved, error } = await supabase
    .from('restock_calculations')
    .insert(toCalcRow(result, run.settings, { id: user.id, name: profile.full_name }))
    .select('*')
    .single()
  if (error || !saved) {
    return Response.json({ error: 'Failed to save calculation', details: error?.message }, { status: 500 })
  }

  return Response.json({ calculation: saved, result, settings: run.settings, today: run.today })
}
