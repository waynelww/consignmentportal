import type { SupabaseClient } from '@supabase/supabase-js'

export interface MemberStats {
  totalPairs: number
  topProducts: { name: string; pairs: number }[]
}

// Lifetime pairs bought + top products, from item rows captured off the
// Shopee/TikTok exports (see gang_order_items) for every VALID order tied
// to this member. Orders with no captured item rows (e.g. registered via
// a plain order-number paste, with nothing to extract) just don't
// contribute — the stats are best-effort, not a full purchase ledger.
export async function getMemberStats(supabase: SupabaseClient, memberId: string): Promise<MemberStats> {
  const { data: submissions } = await supabase
    .from('gang_order_submissions')
    .select('order_number')
    .eq('member_id', memberId)
    .eq('status', 'valid')

  const orderNumbers = (submissions ?? []).map((s) => s.order_number)
  if (!orderNumbers.length) return { totalPairs: 0, topProducts: [] }

  const { data: items } = await supabase
    .from('gang_order_items')
    .select('product_name, quantity')
    .in('order_number', orderNumbers)

  const totals = new Map<string, number>()
  let totalPairs = 0
  for (const item of items ?? []) {
    totalPairs += item.quantity
    totals.set(item.product_name, (totals.get(item.product_name) ?? 0) + item.quantity)
  }

  const topProducts = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, pairs]) => ({ name, pairs }))

  return { totalPairs, topProducts }
}
