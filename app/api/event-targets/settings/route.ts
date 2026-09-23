import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess, loadTargetSettings } from '@/lib/events/target-api'

const SettingsSchema = z.object({
  per_head_small: z.number().min(0),
  per_head_medium: z.number().min(0),
  per_head_major: z.number().min(0),
  tier1_pct_of_tier2: z.number().min(10).max(100),
  tier3_pct_of_tier2: z.number().min(100).max(500),
  bonus_tier1: z.number().min(0),
  bonus_tier2: z.number().min(0),
  bonus_tier3: z.number().min(0),
  round_to: z.number().min(1),
  avg_sale_per_customer: z.number().min(1),
  min_cover_ratio: z.number().min(0),
})

export async function GET() {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  return Response.json({ settings: await loadTargetSettings(), can_edit: ctx.role === 'super_admin' })
}

export async function PATCH(request: NextRequest) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  if (ctx.role !== 'super_admin') {
    return Response.json({ error: 'Only an admin can change target settings.' }, { status: 403 })
  }

  const parsed = SettingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = await createServiceClient()
  const { error } = await svc
    .from('event_target_settings')
    .upsert({ id: 1, ...parsed.data, updated_at: new Date().toISOString() })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, settings: parsed.data })
}
