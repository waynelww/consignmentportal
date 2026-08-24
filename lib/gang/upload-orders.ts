import type { SupabaseClient } from '@supabase/supabase-js'
import { grantShopifyPerk } from './grant-perk'

export interface UploadOrdersResult {
  uploaded: number
  matched: number
  stillPending: number
  perksGranted: number
}

export interface UploadOrderInput {
  order_number: string
  platform?: string
  // What was actually bought — powers a member's lifetime pairs/top-products
  // stats. Optional since a plain pasted order-number list (no spreadsheet)
  // can't carry this.
  items?: { product_name: string; quantity: number }[]
}

// Records the day's confirmed order numbers and flips matching pending
// submissions to valid, then grants the Shopify perk for every member with
// a valid order who doesn't have one yet — covers members matched just now
// AND anyone whose grant attempt failed on a previous run (self-healing).
// Shared by the bot-authenticated route and the admin-session route so
// there's exactly one implementation of this reconciliation logic.
export async function uploadGangOrderNumbers(
  supabase: SupabaseClient,
  orderNumbers: UploadOrderInput[],
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

  // Replace (not append) each order's item rows, so re-uploading the same
  // day's file twice by mistake doesn't double-count pairs bought.
  const withItems = orderNumbers.filter((o) => o.items?.length)
  if (withItems.length) {
    const { error: delErr } = await supabase
      .from('gang_order_items')
      .delete()
      .in('order_number', withItems.map((o) => o.order_number.trim()))
    if (delErr) throw new Error(delErr.message)

    const itemRows = withItems.flatMap((o) =>
      (o.items ?? []).map((item) => ({
        order_number: o.order_number.trim(),
        product_name: item.product_name.trim(),
        quantity: item.quantity,
      })),
    )
    if (itemRows.length) {
      const { error: itemErr } = await supabase.from('gang_order_items').insert(itemRows)
      if (itemErr) throw new Error(itemErr.message)
    }
  }
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
