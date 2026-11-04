import { createClient, createServiceClient } from '@/lib/supabase/server'

// Store-side view of Office (HQ) stock. Stores see WHICH products are
// currently unavailable at HQ, never the quantities.
// GET → { unavailable_product_ids: string[] }   (HQ available = 0)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const service = await createServiceClient()
  const { data, error } = await service
    .from('products')
    .select('id')
    .eq('hq_available_qty', 0)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ unavailable_product_ids: (data ?? []).map((r: { id: string }) => r.id) })
}
