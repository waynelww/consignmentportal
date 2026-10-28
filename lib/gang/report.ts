import type { SupabaseClient } from '@supabase/supabase-js'

// Shopee/TikTok-focused CRM report. Website members are deliberately
// excluded from the analysis — their data already lives in Shopify; the
// Gang CRM's purpose is capturing marketplace customers.

export interface GangReport {
  period: 'weekly' | 'monthly'
  periodLabel: string
  sinceISO: string
  // In-period (new this week/month)
  newMembers: { shopee: number; tiktok: number; total: number }
  newOrders: { shopee: number; tiktok: number; total: number }
  // Cumulative
  totalMembers: { shopee: number; tiktok: number; multi: number; total: number }
  signupRate: { shopee: string; tiktok: string }
  uploadedOrders: { shopee: number; tiktok: number }
  registeredOrders: { shopee: number; tiktok: number }
  pendingBacklog: number
  lastUploadBatch: string | null
  repeatCustomers: number
  websiteCrossover: number
}

interface SubRow {
  member_id: string
  platform: string
  status: string
  created_at: string
}

async function fetchAllSubmissions(supabase: SupabaseClient): Promise<SubRow[]> {
  const all: SubRow[] = []
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from('gang_order_submissions')
      .select('member_id, platform, status, created_at')
      .order('created_at', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(`submissions fetch failed: ${error.message}`)
    all.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return all
}

async function countValidOrders(
  supabase: SupabaseClient,
  platform: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('gang_valid_orders')
    .select('id', { count: 'exact', head: true })
    .eq('platform', platform)
  if (error) throw new Error(`valid orders count failed: ${error.message}`)
  return count ?? 0
}

export async function buildGangReport(
  supabase: SupabaseClient,
  period: 'weekly' | 'monthly',
): Promise<GangReport> {
  // Period boundaries in MYT (UTC+8).
  const nowMYT = new Date(Date.now() + 8 * 3600_000)
  let since: Date
  let periodLabel: string
  if (period === 'weekly') {
    since = new Date(nowMYT.getTime() - 7 * 86400_000)
    periodLabel = `${since.toISOString().slice(0, 10)} → ${nowMYT.toISOString().slice(0, 10)}`
  } else {
    // Previous calendar month.
    const firstOfThisMonth = new Date(Date.UTC(nowMYT.getUTCFullYear(), nowMYT.getUTCMonth(), 1))
    since = new Date(Date.UTC(firstOfThisMonth.getUTCFullYear(), firstOfThisMonth.getUTCMonth() - 1, 1))
    periodLabel = since.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }
  const sinceISO = new Date(since.getTime() - 8 * 3600_000).toISOString() // back to UTC
  const untilISO =
    period === 'monthly'
      ? new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 1, 1) - 8 * 3600_000).toISOString()
      : new Date().toISOString()

  const subs = await fetchAllSubmissions(supabase)

  // Per-member platform aggregation (all time).
  const byMember = new Map<string, { platforms: Set<string>; stCount: number; firstST: string | null }>()
  for (const s of subs) {
    if (!byMember.has(s.member_id)) {
      byMember.set(s.member_id, { platforms: new Set(), stCount: 0, firstST: null })
    }
    const m = byMember.get(s.member_id)!
    m.platforms.add(s.platform)
    if (s.platform === 'shopee' || s.platform === 'tiktok') {
      m.stCount++
      if (!m.firstST || s.created_at < m.firstST) m.firstST = s.created_at
    }
  }

  const totals = { shopee: 0, tiktok: 0, multi: 0, total: 0 }
  let repeatCustomers = 0
  let websiteCrossover = 0
  const newMembers = { shopee: 0, tiktok: 0, total: 0 }
  for (const m of byMember.values()) {
    const st = [...m.platforms].filter((p) => p === 'shopee' || p === 'tiktok')
    if (st.length === 0) continue // website-only member — out of scope
    totals.total++
    if (st.length > 1) totals.multi++
    else if (st[0] === 'shopee') totals.shopee++
    else totals.tiktok++
    if (m.stCount > 1) repeatCustomers++
    if (m.platforms.has('website')) websiteCrossover++
  }

  // "New member" = their first-ever marketplace order landed in the period,
  // attributed to the platform of that first order.
  for (const s of subs) {
    if (s.platform !== 'shopee' && s.platform !== 'tiktok') continue
    const m = byMember.get(s.member_id)!
    if (s.created_at !== m.firstST) continue
    if (s.created_at < sinceISO || s.created_at >= untilISO) continue
    newMembers.total++
    if (s.platform === 'shopee') newMembers.shopee++
    else newMembers.tiktok++
  }

  const newOrders = { shopee: 0, tiktok: 0, total: 0 }
  const registeredOrders = { shopee: 0, tiktok: 0 }
  let pendingBacklog = 0
  for (const s of subs) {
    if (s.platform !== 'shopee' && s.platform !== 'tiktok') continue
    registeredOrders[s.platform as 'shopee' | 'tiktok']++
    if (s.status === 'pending') pendingBacklog++
    if (s.created_at >= sinceISO && s.created_at < untilISO) {
      newOrders.total++
      newOrders[s.platform as 'shopee' | 'tiktok']++
    }
  }

  const [shopeeUploaded, tiktokUploaded] = await Promise.all([
    countValidOrders(supabase, 'shopee'),
    countValidOrders(supabase, 'tiktok'),
  ])

  const { data: lastBatch } = await supabase
    .from('gang_valid_orders')
    .select('batch_date')
    .order('batch_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const rate = (reg: number, up: number) => (up > 0 ? `${((reg / up) * 100).toFixed(1)}%` : '—')

  return {
    period,
    periodLabel,
    sinceISO,
    newMembers,
    newOrders,
    totalMembers: totals,
    signupRate: {
      shopee: rate(registeredOrders.shopee, shopeeUploaded),
      tiktok: rate(registeredOrders.tiktok, tiktokUploaded),
    },
    uploadedOrders: { shopee: shopeeUploaded, tiktok: tiktokUploaded },
    registeredOrders,
    pendingBacklog,
    lastUploadBatch: lastBatch?.batch_date ?? null,
    repeatCustomers,
    websiteCrossover,
  }
}
