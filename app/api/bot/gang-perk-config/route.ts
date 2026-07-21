import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'

const ConfigSchema = z.object({
  price_per_pair: z.number().positive(),
  free_pairs: z.number().int().positive(),
  min_buy_pairs: z.number().int().positive(),
})

// GET /api/bot/gang-perk-config — the current active config, for the
// /gangperk bot command to display.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('gang_perk_config')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ config: data })
}

// POST /api/bot/gang-perk-config — replaces the active config: deactivates
// the current one (if any) and inserts a new active row. Existing members'
// already-granted discount codes keep their original terms; only new grants
// use the new numbers.
export async function POST(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = ConfigSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { error: deactivateErr } = await supabase
    .from('gang_perk_config')
    .update({ active: false })
    .eq('active', true)
  if (deactivateErr) return Response.json({ error: deactivateErr.message }, { status: 500 })

  const { data, error } = await supabase
    .from('gang_perk_config')
    .insert({ ...parsed.data, active: true })
    .select('*')
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ config: data })
}
