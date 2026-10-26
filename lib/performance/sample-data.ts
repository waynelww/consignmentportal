// Clearly-labelled sample payloads for dashboard sections whose data source
// isn't connected yet. Phase 2 (Meta Ads API) and Phase 3 (organic content)
// replace these with real synced data — the response shape stays identical,
// so the UI never branches on sample vs real beyond showing the badge.

export interface MetaAdsSection {
  sample: boolean
  spend: number
  impressions: number
  clicks: number
  purchases: number
  purchaseValue: number
  platformRoas: number // Meta-attributed: purchaseValue / spend
  blendedRoas: number | null // (online + shopee + tiktok revenue) / spend — real once spend is real
  topAds: SampleAd[]
  worstAds: SampleAd[]
}

export interface SampleAd {
  name: string
  spend: number
  roas: number
  purchases: number
  ctr: number
}

export interface OrganicSection {
  sample: boolean
  periodDays: number
  goodPosts: SamplePost[]
  badPosts: SamplePost[]
  medianReach: number
}

export interface SamplePost {
  caption: string
  platform: 'instagram' | 'facebook'
  mediaType: string
  reach: number
  engagementRate: number
}

export const SAMPLE_META: MetaAdsSection = {
  sample: true,
  spend: 3240,
  impressions: 412000,
  clicks: 8900,
  purchases: 186,
  purchaseValue: 9120,
  platformRoas: 2.81,
  blendedRoas: null,
  topAds: [
    { name: 'UGC — "socks that survive futsal"', spend: 620, roas: 4.8, purchases: 52, ctr: 2.9 },
    { name: 'Carousel — Merdeka drop', spend: 480, roas: 3.6, purchases: 31, ctr: 2.1 },
    { name: 'Reel — packing ASMR', spend: 310, roas: 3.1, purchases: 18, ctr: 1.8 },
  ],
  worstAds: [
    { name: 'Static — plain product shot v3', spend: 390, roas: 0.6, purchases: 4, ctr: 0.4 },
    { name: 'Retarget — 180d lapsed', spend: 280, roas: 0.9, purchases: 5, ctr: 0.7 },
  ],
}

export const SAMPLE_ORGANIC: OrganicSection = {
  sample: true,
  periodDays: 90,
  medianReach: 4200,
  goodPosts: [
    { caption: 'POV: your socks match your whole fit…', platform: 'instagram', mediaType: 'REEL', reach: 48200, engagementRate: 7.2 },
    { caption: 'Behind the booth at BOOM+ Run', platform: 'instagram', mediaType: 'CAROUSEL', reach: 18400, engagementRate: 5.1 },
  ],
  badPosts: [
    { caption: 'New restock announcement (text only)', platform: 'facebook', mediaType: 'IMAGE', reach: 820, engagementRate: 0.6 },
    { caption: 'Promo reminder repost', platform: 'instagram', mediaType: 'IMAGE', reach: 1100, engagementRate: 0.9 },
  ],
}
