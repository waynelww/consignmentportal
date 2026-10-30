// Reads and writes the per-store daily report settings
// (public.store_daily_report_settings). Server only. Admin-only in the database:
// store users cannot read these rows, so recipients never reach a store.
// A missing row means the switch is off with no recipients.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeRecipients, validateDailyReportSettings } from './settings'

export interface DailyReportConfig {
  enabled: boolean
  recipients: string[]
}

export const OFF_CONFIG: DailyReportConfig = { enabled: false, recipients: [] }

export async function loadDailyReportConfig(db: SupabaseClient, storeId: string): Promise<DailyReportConfig> {
  const { data, error } = await db
    .from('store_daily_report_settings')
    .select('enabled, recipients')
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return OFF_CONFIG
  return { enabled: data.enabled as boolean, recipients: (data.recipients as string[]) ?? [] }
}

/**
 * Saves the switch and recipients for one store. Returns an error message to
 * show (and writes nothing) when the pair breaks the rule, else null.
 */
export async function saveDailyReportConfig(
  db: SupabaseClient,
  storeId: string,
  config: { enabled: boolean; recipients: string[] },
  updatedBy: string | null,
): Promise<string | null> {
  const recipients = normalizeRecipients(config.recipients)
  const error = validateDailyReportSettings(config.enabled, recipients)
  if (error) return error

  const { error: upsertErr } = await db.from('store_daily_report_settings').upsert({
    store_id: storeId,
    enabled: config.enabled,
    recipients,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  })
  if (upsertErr) throw new Error(upsertErr.message)
  return null
}
