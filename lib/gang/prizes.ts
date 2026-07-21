import type { SupabaseClient } from '@supabase/supabase-js'

export interface GangPrize {
  id: string
  cadence: 'monthly' | 'daily'
  tier_label: string
  prize_label: string
  probability_text: string | null
}

// Shared by the public prizes route, the register route's response, and the
// registration page's server-rendered initial state.
export async function getActivePrizes(supabase: SupabaseClient): Promise<GangPrize[]> {
  const { data, error } = await supabase
    .from('gang_prizes')
    .select('id, cadence, tier_label, prize_label, probability_text')
    .eq('active', true)
    .order('cadence', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data ?? []
}
