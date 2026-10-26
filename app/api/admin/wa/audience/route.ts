import { createServiceClient } from '@/lib/supabase/server'
import { requireWaAdmin } from '@/lib/wa/require-admin'
import { pageAll } from '@/lib/performance/channels'

// GET /api/admin/wa/audience — facets of active consignment stores for the
// blast audience picker (store types and states with counts).
export async function GET() {
  const { denied } = await requireWaAdmin()
  if (denied) return denied

  const db = await createServiceClient()
  const stores = await pageAll<{ store_type: string; state: string }>((from, to) =>
    db
      .from('stores')
      .select('store_type, state')
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, to),
  )

  const count = (key: 'store_type' | 'state') => {
    const map = new Map<string, number>()
    for (const s of stores) {
      const v = (s[key] || '').trim()
      if (!v) continue
      map.set(v, (map.get(v) ?? 0) + 1)
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, n]) => ({ value, count: n }))
  }

  return Response.json({
    total_active: stores.length,
    store_types: count('store_type'),
    states: count('state'),
  })
}
