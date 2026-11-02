// Personal PIN hashes for the /hr link, in hr_member_pins (server-only: RLS on,
// no policies, revoked from anon/authenticated). Never send a hash to a browser.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function getPinHash(db: SupabaseClient, memberId: string): Promise<string | null> {
  const { data } = await db.from('hr_member_pins').select('pin_hash').eq('member_id', memberId).maybeSingle()
  return data?.pin_hash ?? null
}

/** Sets the PIN only if the person has none yet. False when another device set one first. */
export async function claimPin(db: SupabaseClient, memberId: string, pinHash: string): Promise<boolean> {
  const { error } = await db.from('hr_member_pins').insert({ member_id: memberId, pin_hash: pinHash })
  if (error?.code === '23505') return false
  if (error) throw new Error(`Could not save PIN: ${error.message}`)
  return true
}

export async function clearPin(db: SupabaseClient, memberId: string): Promise<void> {
  const { error } = await db.from('hr_member_pins').delete().eq('member_id', memberId)
  if (error) throw new Error(`Could not reset PIN: ${error.message}`)
}

/** Ids of everyone who has set a PIN. */
export async function membersWithPin(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from('hr_member_pins').select('member_id')
  return new Set((data ?? []).map((r: { member_id: string }) => r.member_id))
}
