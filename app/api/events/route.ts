import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const CreateEventSchema = z.object({
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional().nullable(),
  shopify_location_id: z.string().trim().optional().nullable(),
  shopify_location_name: z.string().trim().optional().nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { supabase, user }
}

export async function GET() {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { supabase } = ctx

  const { data, error } = await supabase
    .from('events')
    .select('*, items:event_stock_items(quantity_taken, quantity_returned)')
    .order('start_date', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const events = (data ?? []).map((e) => {
    const items = (e.items as Array<{ quantity_taken: number; quantity_returned: number | null }>) ?? []
    return {
      ...e,
      items: undefined,
      sku_count: items.length,
      total_taken: items.reduce((s, i) => s + i.quantity_taken, 0),
    }
  })

  return Response.json({ events })
}

export async function POST(request: NextRequest) {
  const ctx = await requireAdmin()
  if (ctx.error) return ctx.error
  const { supabase, user } = ctx

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const parsed = CreateEventSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('events')
    .insert({ ...parsed.data, created_by: user!.id })
    .select('id')
    .single()

  if (error || !data) return Response.json({ error: error?.message ?? 'Failed to create event' }, { status: 500 })

  return Response.json({ success: true, id: data.id })
}
