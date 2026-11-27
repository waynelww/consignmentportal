import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess, loadTargetSettings, loadProfitUnlockAmount, recalcPosBonus } from '@/lib/events/target-api'

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
  profit_unlock_amount: z.number().min(0).max(1000000),
})

export async function GET() {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const [settings, profit_unlock_amount] = await Promise.all([loadTargetSettings(), loadProfitUnlockAmount()])
  // Admin and ops manager can both edit (Target settings button on Events).
  return Response.json({ settings: { ...settings, profit_unlock_amount }, can_edit: true, is_admin: ctx.role === 'super_admin' })
}

export async function PATCH(request: NextRequest) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const parsed = SettingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = await createServiceClient()
  const { error } = await svc
    .from('event_target_settings')
    .upsert({ id: 1, ...parsed.data, updated_at: new Date().toISOString() })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // profit_unlock_amount moves the bonus line → recompute active events' POS sales.
  const { data: active } = await svc.from('events').select('id').eq('status', 'active')
  const ids = (active ?? []).map((e) => e.id)
  if (ids.length) {
    const { data: linked } = await svc.from('event_targets').select('event_id').in('event_id', ids)
    for (const l of linked ?? []) if (l.event_id) await recalcPosBonus(l.event_id)
  }
  return Response.json({ ok: true, settings: parsed.data })
}
