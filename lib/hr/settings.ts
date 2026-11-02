// Settings the HR module reads. Rows live in hr_secrets (server-only), not
// public.settings, so ops logins can neither read nor change them; missing or
// invalid values fall back to defaults. The report recipient has no default
// on purpose: the cron refuses to send without it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkDays } from './rules'

export const HR_SETTING_KEYS = {
  email: 'hr_report_email',
  latePenalty: 'hr_late_penalty_default',
  workDays: 'hr_work_days',
} as const

export const HR_LATE_PENALTY_DEFAULT = 10

export interface HrSettings {
  email: string | null
  latePenalty: number
  workDays: number[]
}

export function parseHrSettings(rows: { key: string; value: string | null }[]): HrSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const penalty = Number(byKey.get(HR_SETTING_KEYS.latePenalty)?.trim())
  return {
    email: byKey.get(HR_SETTING_KEYS.email)?.trim() || null,
    latePenalty: Number.isFinite(penalty) && penalty >= 0 ? penalty : HR_LATE_PENALTY_DEFAULT,
    workDays: parseWorkDays(byKey.get(HR_SETTING_KEYS.workDays)),
  }
}

/** db must be a service-role client: hr_secrets has no policies. */
export async function loadHrSettings(db: SupabaseClient): Promise<HrSettings> {
  const { data } = await db.from('hr_secrets').select('key, value').in('key', Object.values(HR_SETTING_KEYS))
  return parseHrSettings(data ?? [])
}

export async function loadHolidaySet(db: SupabaseClient, from?: string, to?: string): Promise<Set<string>> {
  let q = db.from('hr_public_holidays').select('holiday_date')
  if (from) q = q.gte('holiday_date', from)
  if (to) q = q.lte('holiday_date', to)
  const { data } = await q
  return new Set((data ?? []).map((h: { holiday_date: string }) => h.holiday_date))
}
