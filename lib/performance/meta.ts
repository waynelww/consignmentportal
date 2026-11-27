import type { SupabaseClient } from '@supabase/supabase-js'
import { pageAll } from './channels'
import { SAMPLE_META, type MetaAdsSection, type SampleAd } from './sample-data'

// Real Meta Ads aggregation (Phase 2) over meta_ad_insights, returned in the
// exact SAMPLE_META shape so the dashboard never branches beyond the badge.
//
// Falls back to the clearly-badged sample payload only while the table is
// completely empty (sync never ran); once any data exists, a period with no
// spend honestly shows zeros.

const MIN_AD_SPEND = 50 // RM — below this, ROAS rankings are noise
const RANKED = 3

interface InsightRow {
  ad_id: string
  ad_name: string | null
  spend: number
  impressions: number
  clicks: number
  purchases: number
  purchase_value: number
}

export async function aggMeta(db: SupabaseClient, start: string, end: string): Promise<MetaAdsSection> {
  const rows = await pageAll<InsightRow>((from, to) =>
    db
      .from('meta_ad_insights')
      .select('ad_id, ad_name, spend, impressions, clicks, purchases, purchase_value')
      .gte('date_myt', start)
      .lte('date_myt', end)
      .range(from, to),
  )

  if (!rows.length) {
    const { count } = await db.from('meta_ad_insights').select('ad_id', { count: 'exact', head: true }).limit(1)
    if (!count) return SAMPLE_META // sync never ran — keep the badged sample
  }

  let spend = 0
  let impressions = 0
  let clicks = 0
  let purchases = 0
  let purchaseValue = 0
  const byAd = new Map<string, InsightRow & { name: string }>()

  for (const r of rows) {
    spend += Number(r.spend)
    impressions += Number(r.impressions)
    clicks += Number(r.clicks)
    purchases += Number(r.purchases)
    purchaseValue += Number(r.purchase_value)

    const agg = byAd.get(r.ad_id)
    if (agg) {
      agg.spend += Number(r.spend)
      agg.impressions += Number(r.impressions)
      agg.clicks += Number(r.clicks)
      agg.purchases += Number(r.purchases)
      agg.purchase_value += Number(r.purchase_value)
      if (r.ad_name) agg.name = r.ad_name
    } else {
      byAd.set(r.ad_id, {
        ...r,
        spend: Number(r.spend),
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        purchases: Number(r.purchases),
        purchase_value: Number(r.purchase_value),
        name: r.ad_name ?? r.ad_id,
      })
    }
  }

  const toAd = (a: InsightRow & { name: string }): SampleAd => ({
    name: a.name,
    spend: round2(a.spend),
    roas: a.spend > 0 ? round2(a.purchase_value / a.spend) : 0,
    purchases: a.purchases,
    ctr: a.impressions > 0 ? round2((a.clicks / a.impressions) * 100) : 0,
  })
  const ranked = [...byAd.values()]
    .filter((a) => a.spend >= MIN_AD_SPEND)
    .sort((a, b) => (b.purchase_value / Math.max(b.spend, 1)) - (a.purchase_value / Math.max(a.spend, 1)))

  const topAds = ranked.slice(0, RANKED).map(toAd)
  // Worst from the tail, never re-listing a top ad (small accounts overlap).
  const worstAds = ranked.slice(RANKED).slice(-RANKED).reverse().map(toAd)

  return {
    sample: false,
    spend: round2(spend),
    impressions,
    clicks,
    purchases,
    purchaseValue: round2(purchaseValue),
    platformRoas: spend > 0 ? round2(purchaseValue / spend) : 0,
    blendedRoas: null, // computed client-side against online-channel revenue
    topAds,
    worstAds,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
