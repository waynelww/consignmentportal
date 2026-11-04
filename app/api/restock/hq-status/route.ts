import { createClient, createServiceClient } from '@/lib/supabase/server'
import { normalizeSku, type HqStockMap } from '@/lib/stock/hq-availability'
import { suggestSimilar, suggestionLabel } from '@/lib/stock/colour-suggestions'

// Store-side view of Office (HQ) stock. Stores see WHICH products are
// currently unavailable and the similar colour codes/names. Never quantities.
// GET → {
//   unavailable_product_ids: string[],          // HQ available = 0
//   similar: { [product_id]: string[] }         // e.g. "A18 Grey Black"
// }
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const service = await createServiceClient()
  const { data, error } = await service.from('products').select('id, sku, hq_available_qty')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as { id: string; sku: string; hq_available_qty: number | null }[]
  const hq: HqStockMap = new Map(rows.map((r) => [normalizeSku(r.sku), r.hq_available_qty]))
  const unavailable = rows.filter((r) => r.hq_available_qty === 0)

  const similar: Record<string, string[]> = {}
  for (const r of unavailable) {
    const sug = suggestSimilar(r.sku, 0, hq)
    if (sug.length) similar[r.id] = sug.map(suggestionLabel)
  }

  return Response.json({ unavailable_product_ids: unavailable.map((r) => r.id), similar })
}
