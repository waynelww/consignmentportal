import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'

const PrizeSchema = z.object({
  id: z.string().uuid().optional(),
  cadence: z.enum(['monthly', 'daily']),
  tier_label: z.string().min(1),
  prize_label: z.string().min(1),
  probability_text: z.string().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().optional(),
})

// GET /api/bot/gang-prizes — all tiers (including inactive), for the /prizes
// bot command to display and edit.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('gang_prizes')
    .select('*')
    .order('cadence', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ prizes: data ?? [] })
}

// POST /api/bot/gang-prizes — create (no id) or update (with id) a tier.
export async function POST(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = PrizeSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { id, ...fields } = parsed.data

  if (id) {
    const { data, error } = await supabase
      .from('gang_prizes')
      .update(fields)
      .eq('id', id)
      .select('*')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ prize: data })
  }

  const { data, error } = await supabase.from('gang_prizes').insert(fields).select('*').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ prize: data })
}
