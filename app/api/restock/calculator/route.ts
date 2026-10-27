import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { listActiveStores, requireRestockCalcAccess, runWayneCalc, toCalcRow } from '@/lib/restock/wayne-api'
import { DEFAULT_PERIOD_MONTHS, isPeriodMonths } from '@/lib/restock/wayne-calc'

// Restock Calculator (Wayne's method). super_admin + ops_manager only.
// GET                              → active stores for the dropdown
// GET  ?store_id=&months=2|3       → calculate one store (never saved)
// POST { store_id, months, edited_sends? }
//      → recalculates server-side and saves the result (plus any edited Send
//        numbers) to restock_calculations. Only called by "Save calculation"
//        and by "Create restock request".
export async function GET(request: NextRequest) {
  const access = await requireRestockCalcAccess()
  if ('error' in access) return access.error

  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store_id')
  const monthsParam = searchParams.get('months')
  const months = monthsParam === null ? DEFAULT_PERIOD_MONTHS : Number(monthsParam)
  if (!isPeriodMonths(months)) {
    return Response.json({ error: 'months must be 2 or 3' }, { status: 400 })
  }

  try {
    if (!storeId) return Response.json({ stores: await listActiveStores() })
    const run = await runWayneCalc({ months, storeIds: [storeId] })
    const result = run.stores[0]
    if (!result) return Response.json({ error: 'Store not found or not active' }, { status: 404 })
    return Response.json({ today: run.today, months: run.months, settings: run.settings, result })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Calculation failed' }, { status: 500 })
  }
}

const SaveSchema = z.object({
  store_id: z.string().uuid(),
  months: z.union([z.literal(2), z.literal(3)]),
  edited_sends: z.record(z.string().uuid(), z.number().int().min(0).max(100000)).optional(),
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
    run = await runWayneCalc({ months: parsed.data.months, storeIds: [parsed.data.store_id] })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Calculation failed' }, { status: 500 })
  }
  const result = run.stores[0]
  if (!result) return Response.json({ error: 'Store not found or not active' }, { status: 404 })

  const row = toCalcRow(result, run.settings, { id: user.id, name: profile.full_name }, run.today)
  if (parsed.data.edited_sends) {
    const known = new Map(result.skus.map((s) => [s.product_id, s.send]))
    const overrides: Record<string, number> = {}
    for (const [pid, qty] of Object.entries(parsed.data.edited_sends)) {
      if (!known.has(pid)) {
        return Response.json({ error: 'Store data changed since the page loaded — reload the store and try again' }, { status: 409 })
      }
      if (known.get(pid) !== qty) overrides[pid] = qty // keep only real edits
    }
    if (Object.keys(overrides).length) {
      Object.assign(row, {
        edited_sends: overrides,
        final_total: result.skus.reduce((a, s) => a + (overrides[s.product_id] ?? s.send), 0),
        edited_by: user.id,
        edited_at: new Date().toISOString(),
      })
    }
  }

  const { data: saved, error } = await supabase
    .from('restock_calculations')
    .insert(row)
    .select('*')
    .single()
  if (error || !saved) {
    return Response.json({ error: 'Failed to save calculation', details: error?.message }, { status: 500 })
  }

  return Response.json({ calculation: saved, result, settings: run.settings, today: run.today })
}
