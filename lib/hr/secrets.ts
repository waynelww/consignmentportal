// Server-only key/value secrets for HR (table hr_secrets: RLS on, no policies,
// so only the service role can touch it). Never send these values to a browser.

import type { SupabaseClient } from '@supabase/supabase-js'

export const HR_SECRET_KEYS = {
  portalPasswordHash: 'hr_portal_password_hash',
  driveRefreshToken: 'google_drive_refresh_token',
  driveAccount: 'google_drive_account',
  driveRootFolderId: 'google_drive_root_folder_id',
} as const

export async function getHrSecret(db: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await db.from('hr_secrets').select('value').eq('key', key).maybeSingle()
  return data?.value?.trim() || null
}

export async function setHrSecret(db: SupabaseClient, key: string, value: string): Promise<void> {
  const { error } = await db.from('hr_secrets').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`Could not save ${key}: ${error.message}`)
}

export async function deleteHrSecrets(db: SupabaseClient, keys: string[]): Promise<void> {
  await db.from('hr_secrets').delete().in('key', keys)
}
