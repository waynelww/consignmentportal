import { createAdminClient } from '@/lib/supabase/admin'

// Syncs daily ad-level insights from the Meta Marketing API into
// meta_ad_insights for the performance dashboard (Phase 2).
//
// Default run re-fetches the trailing 28 days: Meta restates attributed
// purchases for up to 28 days after the click, so there is no safe forward
// watermark — the window is simply re-upserted every run. Backfill further
// back by calling with explicit { start, end } slices (≤ 93 days each, the
// Graph API limit for time_increment=1 queries).
//
// Env: META_ADS_TOKEN (falls back to WHATSAPP_TOKEN — one system user can
// carry both scopes), META_AD_ACCOUNT_ID (defaults to Xocks Marketing).

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v24.0'
const DEFAULT_AD_ACCOUNT = '702451797531539' // Xocks Marketing (MYR)
const SYNC_SETTINGS_KEY = 'meta_insights_sync'
const TRAILING_DAYS = 28
const MAX_RANGE_DAYS = 93
const PAGE_LIMIT = 200

export interface MetaSyncResult {
  success: true
  range: { since: string; until: string }
  pages: number
  rowsUpserted: number
}

export interface MetaSyncError {
  success: false
  error: string
  status: number
}

interface ActionEntry {
  action_type: string
  value: string
}

interface InsightRow {
  date_start: string
  ad_id: string
  ad_name?: string
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
  spend?: string
  impressions?: string
  clicks?: string
  actions?: ActionEntry[]
  action_values?: ActionEntry[]
}

interface InsightsPage {
  data: InsightRow[]
  paging?: { next?: string }
  error?: { message?: string; code?: number; type?: string }
}

// Meta reports purchases under several action types; omni_purchase is the
// deduplicated cross-channel one. Fall back for accounts where it is absent.
function purchaseMetric(entries: ActionEntry[] | undefined): number {
  if (!entries?.length) return 0
  const hit =
    entries.find((a) => a.action_type === 'omni_purchase') ??
    entries.find((a) => a.action_type === 'purchase') ??
    entries.find((a) => a.action_type === 'offsite_conversion.fb_pixel_purchase')
  const n = Number(hit?.value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function num(v: string | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

// MYT is UTC+8 with no DST.
function mytToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function syncMetaInsights(opts?: {
  start?: string // YYYY-MM-DD
  end?: string // YYYY-MM-DD (inclusive)
}): Promise<MetaSyncResult | MetaSyncError> {
  const token = process.env.META_ADS_TOKEN || process.env.WHATSAPP_TOKEN
  if (!token) {
    return { success: false, status: 500, error: 'Missing META_ADS_TOKEN / WHATSAPP_TOKEN env var' }
  }
  const account = process.env.META_AD_ACCOUNT_ID || DEFAULT_AD_ACCOUNT

  const until = opts?.end ?? mytToday()
  const since = opts?.start ?? addDays(until, -(TRAILING_DAYS - 1))
  if (since > until) {
    return { success: false, status: 400, error: 'start must be <= end' }
  }
  const spanDays = (new Date(`${until}T00:00:00Z`).getTime() - new Date(`${since}T00:00:00Z`).getTime()) / 86400_000 + 1
  if (spanDays > MAX_RANGE_DAYS) {
    return { success: false, status: 400, error: `Range too wide (${spanDays}d) — slice backfills into ≤${MAX_RANGE_DAYS}-day calls` }
  }

  const fields = [
    'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
    'spend', 'impressions', 'clicks', 'actions', 'action_values',
  ].join(',')
  const params = new URLSearchParams({
    level: 'ad',
    fields,
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    limit: String(PAGE_LIMIT),
  })
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/act_${account}/insights?${params.toString()}`

  const admin = createAdminClient()
  let pages = 0
  let rowsUpserted = 0

  try {
    while (url) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const json = (await res.json().catch(() => null)) as InsightsPage | null
      if (!res.ok || !json || json.error) {
        const msg = json?.error?.message ?? `Graph API HTTP ${res.status}`
        const code = json?.error?.code
        return {
          success: false,
          status: 502,
          error: code === 190 || /permission|OAuth/i.test(msg)
            ? `Meta token rejected (${msg}) — generate a system-user token with ads_read on act_${account} and set META_ADS_TOKEN`
            : msg,
        }
      }
      pages++

      const rows = json.data.map((r) => ({
        date_myt: r.date_start,
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? null,
        adset_id: r.adset_id ?? null,
        adset_name: r.adset_name ?? null,
        campaign_id: r.campaign_id ?? null,
        campaign_name: r.campaign_name ?? null,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        purchases: purchaseMetric(r.actions),
        purchase_value: purchaseMetric(r.action_values),
        synced_at: new Date().toISOString(),
      }))

      if (rows.length) {
        const { error } = await admin.from('meta_ad_insights').upsert(rows, { onConflict: 'date_myt,ad_id' })
        if (error) {
          return { success: false, status: 500, error: `Upsert failed: ${error.message}` }
        }
        rowsUpserted += rows.length
      }

      url = json.paging?.next ?? null
    }
  } catch (err: unknown) {
    return { success: false, status: 502, error: err instanceof Error ? err.message : 'Meta insights fetch failed' }
  }

  await admin.from('settings').upsert(
    {
      key: SYNC_SETTINGS_KEY,
      value: JSON.stringify({ last_run_at: new Date().toISOString(), since, until }),
      description: 'Meta ad insights sync (performance dashboard)',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )

  return { success: true, range: { since, until }, pages, rowsUpserted }
}
