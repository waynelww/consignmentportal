import type { SupabaseClient } from '@supabase/supabase-js'
import { grantShopifyPerk } from './grant-perk'

export interface UploadOrdersResult {
  uploaded: number
  matched: number
  stillPending: number
  perksGranted: number
}

// Records the day's confirmed order numbers and flips matching pending
// submissions to valid, then grants the Shopify perk for every member with
// a valid order who doesn't have one yet — covers members matched just now
// AND anyone whose grant attempt failed on a previous run (self-healing).
// Shared by the bot-authenticated route and the admin-session route so
// there's exactly one implementation of this reconciliation logic.
export async function uploadGangOrderNumbers(
  supabase: SupabaseClient,
  orderNumbers: { order_number: string; platform?: string }[],
  batchDate?: string,
): Promise<UploadOrdersResult> {
  const date = batchDate ?? new Date().toISOString().slice(0, 10)
  const rows = orderNumbers.map((o) => ({
    order_number: o.order_number.trim(),
    platform: o.platform ?? null,
    batch_date: date,
  }))

  const { error: upsertErr } = await supabase.from('gang_valid_orders').upsert(rows, { onConflict: 'order_number' })
  if (upsertErr) throw new Error(upsertErr.message)

  const orderNumberList = rows.map((r) => r.order_number)
  const { data: matched, error: matchErr } = await supabase
    .from('gang_order_submissions')
    .update({ status: 'valid', verified_at: new Date().toISOString() })
    .eq('status', 'pending')
    .in('order_number', orderNumberList)
    .select('id')
  if (matchErr) throw new Error(matchErr.message)

  const { count: stillPending } = await supabase
    .from('gang_order_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  const { data: allValid } = await supabase.from('gang_order_submissions').select('member_id').eq('status', 'valid')
  const candidateMemberIds = [...new Set((allValid ?? []).map((r) => r.member_id))]

  let perksGranted = 0
  if (candidateMemberIds.length) {
    const { data: ungranted } = await supabase
      .from('gang_members')
      .select('id')
      .in('id', candidateMemberIds)
      .is('perk_granted_at', null)

    for (const m of ungranted ?? []) {
      const perk = await grantShopifyPerk(supabase, m.id)
      if (perk) perksGranted++
    }
  }

  return { uploaded: rows.length, matched: matched?.length ?? 0, stillPending: stillPending ?? 0, perksGranted }
}

// Flips remaining pre-cutoff pending submissions to invalid — a deliberately
// separate, explicit action so a partial/staggered upload doesn't wrongly
// invalidate orders that just haven't had their platform's list uploaded yet.
export async function closeOutGangOrders(supabase: SupabaseClient, beforeDate?: string): Promise<number> {
  const cutoff = beforeDate ?? new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('gang_order_submissions')
    .update({ status: 'invalid' })
    .eq('status', 'pending')
    .lte('submitted_date', cutoff)
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}
