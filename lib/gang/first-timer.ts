import type { SupabaseClient } from '@supabase/supabase-js'
import { findOrCreateCustomerByPhone } from '@/lib/shopify/gang-perk'
import { createFreePairDiscount, createLifetimeDiscount } from '@/lib/shopify/gang-codes'

export interface FirstTimerCodes {
  freepair_code: string | null
  lifetime_code: string | null
}

// No O, I, L or 0 — codes get read out loud over WhatsApp and typed on
// phones, so every character must be unambiguous.
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ123456789'

function randomSafe(length: number): string {
  return Array.from({ length }, () => SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)]).join('')
}

// "Wayne Lim" -> "WAYNE10" + 3 safe chars => WAYNE10UFG
function lifetimeCodeFor(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 10)
  return `${first || 'GANG'}10${randomSafe(3)}`
}

function freePairCodeFor(): string {
  return `FREEPAIR-${randomSafe(6)}`
}

/**
 * Issues a first-timer's two personal Shopify codes — the one-time
 * RM13.99-off "free pair" and the name-based lifetime 10% — and stores
 * them on the member row. Idempotent per code: each is only generated if
 * its column is still null, so a partial failure retries just the missing
 * one on the next verification pass. The caller decides WHO is a first
 * timer (first-ever verified order); this only handles the granting.
 */
export async function grantFirstTimerCodes(
  supabase: SupabaseClient,
  memberId: string,
): Promise<FirstTimerCodes | null> {
  const { data: member, error } = await supabase
    .from('gang_members')
    .select('phone, name, email, shopify_customer_id, freepair_code, lifetime_code')
    .eq('id', memberId)
    .single()

  if (error || !member) {
    console.error('[grantFirstTimerCodes] could not load member', memberId, error)
    return null
  }

  if (member.freepair_code && member.lifetime_code) {
    return { freepair_code: member.freepair_code, lifetime_code: member.lifetime_code }
  }

  let customerId = member.shopify_customer_id as string | null
  try {
    if (!customerId) {
      customerId = await findOrCreateCustomerByPhone(member.phone, member.name, member.email ?? '')
      await supabase.from('gang_members').update({ shopify_customer_id: customerId }).eq('id', memberId)
    }
  } catch (err) {
    console.error('[grantFirstTimerCodes] Shopify customer lookup failed, will retry later', memberId, err)
    return null
  }

  let freepair = member.freepair_code as string | null
  let lifetime = member.lifetime_code as string | null

  if (!freepair) {
    try {
      const code = freePairCodeFor()
      await createFreePairDiscount(customerId, code)
      await supabase
        .from('gang_members')
        .update({ freepair_code: code, freepair_granted_at: new Date().toISOString() })
        .eq('id', memberId)
      freepair = code
    } catch (err) {
      console.error('[grantFirstTimerCodes] free pair grant failed, will retry later', memberId, err)
    }
  }

  if (!lifetime) {
    // Suffix collisions (in our DB via the unique index, or on Shopify's
    // side) just roll a new suffix and try again.
    for (let attempt = 0; attempt < 5 && !lifetime; attempt++) {
      const code = lifetimeCodeFor(member.name)
      try {
        await createLifetimeDiscount(customerId, code)
        const { error: saveErr } = await supabase
          .from('gang_members')
          .update({ lifetime_code: code, lifetime_granted_at: new Date().toISOString() })
          .eq('id', memberId)
        if (saveErr) throw new Error(saveErr.message)
        lifetime = code
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/taken|exists|duplicate|unique/i.test(msg)) {
          console.error('[grantFirstTimerCodes] lifetime grant failed, will retry later', memberId, err)
          break
        }
        // collision — loop rolls a fresh suffix
      }
    }
  }

  if (!freepair && !lifetime) return null
  return { freepair_code: freepair, lifetime_code: lifetime }
}

/** True when the member has exactly this many valid submissions — used to
 *  detect "this verification is their first ever". */
export async function countValidSubmissions(supabase: SupabaseClient, memberId: string): Promise<number> {
  const { count } = await supabase
    .from('gang_order_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('status', 'valid')
  return count ?? 0
}
