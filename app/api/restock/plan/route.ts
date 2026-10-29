import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRestockCalcAccess } from '@/lib/restock/wayne-api'
import { recalcStockPlan } from '@/lib/restock/low-stock-data'

// POST /api/restock/plan  { store_ids?: string[] }
// Recalculate the 4-month plan levels now (all active stores, or the given ones).
// The daily summary cron does the same at 09:00 MYT.
const BodySchema = z.object({ store_ids: z.array(z.string().uuid()).max(500).optional() })

export async function POST(request: NextRequest) {
  const access = await requireRestockCalcAccess()
  if ('error' in access) return access.error

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Validation error' }, { status: 400 })

  try {
    const result = await recalcStockPlan({ storeIds: parsed.data.store_ids })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json({ error: 'Plan recalculation failed', details: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
