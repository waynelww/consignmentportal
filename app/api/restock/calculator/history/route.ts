import { type NextRequest } from 'next/server'
import { requireRestockCalcAccess } from '@/lib/restock/wayne-api'

// GET /api/restock/calculator/history?store_id=&limit=
// Saved Restock Calculator runs, newest first (voided rows included).
export async function GET(request: NextRequest) {
  const access = await requireRestockCalcAccess()
  if ('error' in access) return access.error

  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store_id')
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 200)

  let q = access.supabase
    .from('restock_calculations')
    .select('*')
    .order('calculated_at', { ascending: false })
    .limit(limit)
  if (storeId) q = q.eq('store_id', storeId)

  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ calculations: data ?? [] })
}
