import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { calcTargets, DEFAULT_SETTINGS, type TargetSettings } from '@/lib/events/target-calc'

// Shared helpers for the event-target API routes. Mirrors the auth pattern
// of the existing events module: super_admin + ops_manager only; a few
// actions (settings edit, unlock) are super_admin only.
export async function requireEventsAccess() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { supabase, user, role: profile.role as 'super_admin' | 'ops_manager' }
}

export async function loadTargetSettings(): Promise<TargetSettings> {
  const svc = await createServiceClient()
  const { data } = await svc.from('event_target_settings').select('*').eq('id', 1).maybeSingle()
  if (!data) return DEFAULT_SETTINGS
  const s = { ...DEFAULT_SETTINGS }
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof TargetSettings)[]) {
    const v = (data as Record<string, unknown>)[k]
    if (typeof v === 'number') s[k] = v
    else if (typeof v === 'string' && v !== '') s[k] = Number(v)
  }
  return s
}

const DaySchema = z.object({
  label: z.string().trim().min(1).max(40),
  crew: z.number().int().min(0).max(200),
  weight_pct: z.number().min(0).max(100),
})

export const EventTargetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  event_level: z.enum(['small', 'medium', 'major']),
  per_head_override: z.number().min(0).max(100000).nullable().optional(),
  rental: z.number().min(0),
  delivery: z.number().min(0),
  other_fixed: z.number().min(0),
  pt_daily_rate: z.number().min(0),
  days: z.array(DaySchema).min(1).max(14),
})

// Recalculate everything server-side and persist. The client's derived
// numbers are never trusted — announced targets must come from one place.
export async function saveEventTarget(
  body: z.infer<typeof EventTargetSchema>,
  opts: { id?: string; createdBy?: string },
) {
  const svc = await createServiceClient()
  const settings = await loadTargetSettings()
  const result = calcTargets({
    level: body.event_level,
    per_head_override: body.per_head_override ?? null,
    rental: body.rental,
    delivery: body.delivery,
    other_fixed: body.other_fixed,
    pt_daily_rate: body.pt_daily_rate,
    days: body.days,
  }, settings)

  const row = {
    name: body.name,
    start_date: body.start_date ?? null,
    event_level: body.event_level,
    per_head_tier2: result.per_head_tier2,
    rental: body.rental,
    delivery: body.delivery,
    other_fixed: body.other_fixed,
    pt_daily_rate: body.pt_daily_rate,
    pt_days: result.pt_days,
    fixed_cost: result.fixed_cost,
    tier1_total: result.tier1_total,
    tier2_total: result.tier2_total,
    tier3_total: result.tier3_total,
    cover_ratio: result.cover_ratio,
    updated_at: new Date().toISOString(),
  }

  let id = opts.id
  if (id) {
    const { error } = await svc.from('event_targets').update(row).eq('id', id)
    if (error) return { error: error.message }
    await svc.from('event_target_days').delete().eq('event_target_id', id)
  } else {
    const { data, error } = await svc
      .from('event_targets')
      .insert({ ...row, created_by: opts.createdBy ?? null })
      .select('id')
      .single()
    if (error || !data) return { error: error?.message ?? 'insert failed' }
    id = data.id
  }

  const { error: daysErr } = await svc.from('event_target_days').insert(
    result.days.map((d, i) => ({
      event_target_id: id,
      position: i,
      label: d.label,
      crew: d.crew,
      weight_pct: d.weight_pct,
      day_target_tier2: d.day_target_tier2,
      per_person_tier1: d.per_person_tier1,
      per_person_tier2: d.per_person_tier2,
      per_person_tier3: d.per_person_tier3,
    })),
  )
  if (daysErr) return { error: daysErr.message }

  return { id, result, settings }
}
