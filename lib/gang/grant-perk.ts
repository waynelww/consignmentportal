import type { SupabaseClient } from '@supabase/supabase-js'
import { findOrCreateCustomerByPhone, createGangDiscountCode, type GangPerkConfig } from '@/lib/shopify/gang-perk'

export interface GrantedPerk {
  code: string
  min_quantity: number
  discount_amount: number
}

// Grants a member's standing Shopify checkout perk — a discount code equal
// to their phone number — the first time (and only the first time) they
// have a verified-valid order. Idempotent: no-ops if already granted, and
// leaves perk_granted_at null on failure so the next reconciliation pass
// (or another register call) retries automatically.
export async function grantShopifyPerk(
  supabase: SupabaseClient,
  memberId: string,
): Promise<GrantedPerk | null> {
  const { data: member, error: memberErr } = await supabase
    .from('gang_members')
    .select('phone, name, email, perk_granted_at, shopify_discount_code')
    .eq('id', memberId)
    .single()

  if (memberErr || !member) {
    console.error('[grantShopifyPerk] could not load member', memberId, memberErr)
    return null
  }

  if (member.perk_granted_at) {
    return null // already granted — nothing to do
  }

  const { data: config, error: configErr } = await supabase
    .from('gang_perk_config')
    .select('price_per_pair, free_pairs, min_buy_pairs')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<GangPerkConfig>()

  if (configErr || !config) {
    console.warn('[grantShopifyPerk] no active gang_perk_config — skipping for now', memberId)
    return null
  }

  try {
    const customerId = await findOrCreateCustomerByPhone(member.phone, member.name, member.email)
    await createGangDiscountCode({ customerId, code: member.phone, config })

    await supabase
      .from('gang_members')
      .update({
        shopify_customer_id: customerId,
        shopify_discount_code: member.phone,
        perk_granted_at: new Date().toISOString(),
      })
      .eq('id', memberId)

    return {
      code: member.phone,
      min_quantity: config.min_buy_pairs + config.free_pairs,
      discount_amount: Math.round(config.price_per_pair * config.free_pairs * 100) / 100,
    }
  } catch (err) {
    console.error('[grantShopifyPerk] Shopify grant failed, will retry later', memberId, err)
    return null
  }
}
