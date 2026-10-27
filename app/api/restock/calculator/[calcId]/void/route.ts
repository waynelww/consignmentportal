import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRestockCalcAccess } from '@/lib/restock/wayne-api'

// POST /api/restock/calculator/[calcId]/void  { reason }
// Saved calculations are never deleted — they are voided with a reason.
const VoidSchema = z.object({ reason: z.string().trim().min(3).max(500) })

export async function POST(
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
  const parsed = VoidSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'A reason (at least 3 characters) is required' }, { status: 400 })
  }

  const { data: calc } = await supabase
    .from('restock_calculations')
    .select('id, voided_at')
    .eq('id', calcId)
    .single()
  if (!calc) return Response.json({ error: 'Calculation not found' }, { status: 404 })
  if (calc.voided_at) return Response.json({ error: 'Already voided' }, { status: 400 })

  const { data: saved, error } = await supabase
    .from('restock_calculations')
    .update({ voided_at: new Date().toISOString(), voided_by: user.id, void_reason: parsed.data.reason })
    .eq('id', calcId)
    .select('*')
    .single()
  if (error || !saved) {
    return Response.json({ error: 'Failed to void calculation', details: error?.message }, { status: 500 })
  }
  return Response.json({ calculation: saved })
}
