'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DollarSign,
  ShoppingBag,
  Receipt,
  Wallet,
  RefreshCcw,
  Megaphone,
  Sparkles,
  CalendarDays,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { toast } from 'sonner'
import { cn, formatCurrency } from '@/lib/utils'
import MarketplaceUploadCard from '@/components/performance/MarketplaceUploadCard'

// Whole-business performance: Shopify online, POS retail (CM/IOI), booth
// events, consignment stores, Shopee/TikTok (file upload), plus Meta ads and
// organic content (sample data until Phases 2–3 connect them).
//
// Revenue labels are deliberate (handbook rule 6): "Business revenue" = what
// customers paid, "Xocks receivable" = what Xocks keeps/collects.

type ChannelKey = 'online' | 'pos' | 'events' | 'consignment' | 'shopee' | 'tiktok'

const CHANNEL_COLORS: Record<ChannelKey, string> = {
  online: '#0A0A0A',
  pos: '#FFD700',
  events: '#F97316',
  consignment: '#3B82F6',
  shopee: '#EE4D2D',
  tiktok: '#14B8A6',
}

interface Summary {
  period: { start: string; end: string }
  totals: { businessRevenue: number; xocksReceivable: number; unitsSold: number; orders: number }
  channels: {
    key: ChannelKey
    label: string
    revenue: number
    units: number
    orders: number
    sublocations?: { name: string; revenue: number; units: number }[]
  }[]
  trend: ({ date: string } & Record<ChannelKey, number>)[]
  topSkus: { sku: string; name: string; units: number; revenue: number; byChannel: Partial<Record<ChannelKey, number>> }[]
  consignmentStores: {
    top: { storeCode: string; storeName: string; revenue: number; xocksRevenue: number; units: number }[]
    bottom: { storeCode: string; storeName: string; revenue: number; xocksRevenue: number; units: number }[]
  }
  events: {
    id: string
    name: string
    status: string
    dates: string
    unitsSold: number
    orders: number
    shopifyRevenue: number
    target: number | null
    actualSalesManual: number | null
    coverRatio: number | null
  }[]
  xocksTake: {
    consignmentGross: number
    consignmentXocks: number
    shopifyNet: number
    marketplaceGross: number
    totalReceivable: number
  }
  meta: {
    sample: boolean
    spend: number
    impressions: number
    clicks: number
    purchases: number
    purchaseValue: number
    platformRoas: number
    topAds: { name: string; spend: number; roas: number; purchases: number; ctr: number }[]
    worstAds: { name: string; spend: number; roas: number; purchases: number; ctr: number }[]
  }
  organic: {
    sample: boolean
    periodDays: number
    medianReach: number
    goodPosts: { caption: string; platform: string; mediaType: string; reach: number; engagementRate: number }[]
    badPosts: { caption: string; platform: string; mediaType: string; reach: number; engagementRate: number }[]
  }
  freshness: {
    shopifyLastSyncedAt: string | null
    lastMarketplaceUpload: {
      shopee: { uploadedAt: string; dataTo: string | null } | null
      tiktok: { uploadedAt: string; dataTo: string | null } | null
    }
  }
}

// MYT is UTC+8, no DST.
function mytToday(): Date {
  return new Date(Date.now() + 8 * 3600_000)
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function mytRange(preset: string): { start: string; end: string } {
  const now = mytToday()
  const today = iso(now)
  const dow = (now.getUTCDay() + 6) % 7 // Monday = 0
  switch (preset) {
    case 'this_week': {
      const monday = new Date(now.getTime() - dow * 86400_000)
      return { start: iso(monday), end: today }
    }
    case 'last_week': {
      const monday = new Date(now.getTime() - (dow + 7) * 86400_000)
      const sunday = new Date(monday.getTime() + 6 * 86400_000)
      return { start: iso(monday), end: iso(sunday) }
    }
    case 'last_month': {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
      return { start: iso(first), end: iso(last) }
    }
    case 'this_month':
    default: {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      return { start: iso(first), end: today }
    }
  }
}

const PRESETS = [
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
]

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
      <div className="h-8 bg-gray-200 rounded w-32 mb-1" />
      <div className="h-3 bg-gray-100 rounded w-20" />
    </div>
  )
}

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        <div className={cn('p-2 rounded-lg', color)}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function SampleBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-300 text-amber-700 text-[11px] font-semibold px-2.5 py-0.5">
      Sample data — not yet connected
    </span>
  )
}

function SectionCard({
  title,
  icon: Icon,
  sample,
  children,
  className,
}: {
  title: string
  icon?: React.ElementType
  sample?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'bg-white rounded-xl shadow-sm border p-5',
        sample ? 'border-dashed border-amber-300' : 'border-gray-100',
        className,
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          {Icon && <Icon size={16} className="text-gray-400" />}
          {title}
        </h3>
        {sample && <SampleBadge />}
      </div>
      {children}
    </div>
  )
}

function freshnessText(isoTs: string | null): string {
  if (!isoTs) return 'never'
  const mins = Math.round((Date.now() - new Date(isoTs).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

// Groups daily buckets into ISO weeks (Monday-start, MYT dates).
function toWeekly(trend: Summary['trend']): Summary['trend'] {
  const byWeek = new Map<string, { date: string } & Record<ChannelKey, number>>()
  for (const point of trend) {
    const d = new Date(`${point.date}T00:00:00Z`)
    const dow = (d.getUTCDay() + 6) % 7
    const monday = iso(new Date(d.getTime() - dow * 86400_000))
    const bucket =
      byWeek.get(monday) ??
      ({ date: monday, online: 0, pos: 0, events: 0, consignment: 0, shopee: 0, tiktok: 0 } as {
        date: string
      } & Record<ChannelKey, number>)
    for (const key of Object.keys(CHANNEL_COLORS) as ChannelKey[]) {
      bucket[key] += point[key] ?? 0
    }
    byWeek.set(monday, bucket)
  }
  return [...byWeek.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

export default function PerformancePage() {
  const [preset, setPreset] = useState('this_month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [granularity, setGranularity] = useState<'daily' | 'weekly'>('daily')

  const range = useMemo(() => {
    if (preset === 'custom') {
      return customStart && customEnd && customStart <= customEnd ? { start: customStart, end: customEnd } : null
    }
    return mytRange(preset)
  }, [preset, customStart, customEnd])

  const fetchSummary = useCallback(async () => {
    if (!range) return
    setLoading(true)
    try {
      const res = await fetch(`/api/performance/summary?start=${range.start}&end=${range.end}`)
      let json: (Summary & { error?: string }) | null = null
      try {
        json = await res.json()
      } catch {
        // killed function → empty body (handbook rule 4)
      }
      if (!res.ok || !json || json.error) {
        toast.error(json?.error ?? `Failed to load summary (HTTP ${res.status})`)
        return
      }
      setSummary(json)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  const syncNow = async () => {
    setSyncing(true)
    try {
      // Each call stays under the 60s ceiling; loop until the watermark is
      // caught up.
      for (let i = 0; i < 10; i++) {
        const res = await fetch('/api/admin/sync-shopify-orders', { method: 'POST' })
        let json: { done?: boolean; ordersUpserted?: number; error?: string } = {}
        try {
          json = await res.json()
        } catch { /* empty body */ }
        if (!res.ok) {
          toast.error(json.error ?? `Sync failed (HTTP ${res.status})`)
          return
        }
        if (json.done) {
          toast.success('Shopify orders synced')
          await fetchSummary()
          return
        }
      }
      toast.warning('Sync still running — large backlog; try again shortly')
      await fetchSummary()
    } finally {
      setSyncing(false)
    }
  }

  const trendData = useMemo(() => {
    if (!summary) return []
    return granularity === 'weekly' ? toWeekly(summary.trend) : summary.trend
  }, [summary, granularity])

  const activeChannels = useMemo(
    () => (summary ? summary.channels.filter((c) => c.revenue > 0 || c.orders > 0) : []),
    [summary],
  )

  const blendedRoas =
    summary && summary.meta.spend > 0
      ? (summary.channels.filter((c) => ['online', 'shopee', 'tiktok'].includes(c.key)).reduce((s, c) => s + c.revenue, 0) /
          summary.meta.spend)
      : null

  return (
    <div className="space-y-6">
      {/* Header: period + sync + freshness */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium border',
                preset === p.key
                  ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
              )}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <span className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
              />
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {summary && (
            <span className="text-xs text-gray-400">
              Shopify synced {freshnessText(summary.freshness.shopifyLastSyncedAt)}
            </span>
          )}
          <button
            onClick={syncNow}
            disabled={syncing}
            className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || !summary ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <KPICard
              label="Business Revenue"
              value={formatCurrency(summary.totals.businessRevenue)}
              sub="What customers paid, all channels"
              icon={DollarSign}
              color="bg-[#0A0A0A]"
            />
            <KPICard
              label="Units Sold"
              value={summary.totals.unitsSold.toLocaleString()}
              sub="Pairs across all channels"
              icon={ShoppingBag}
              color="bg-blue-500"
            />
            <KPICard
              label="Orders"
              value={summary.totals.orders.toLocaleString()}
              sub="Transactions across all channels"
              icon={Receipt}
              color="bg-orange-500"
            />
            <KPICard
              label="Xocks Receivable"
              value={formatCurrency(summary.totals.xocksReceivable)}
              sub="What Xocks keeps + collects"
              icon={Wallet}
              color="bg-emerald-600"
            />
          </>
        )}
      </div>

      {/* Channel split */}
      {summary && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {summary.channels.map((ch) => {
            const pct = summary.totals.businessRevenue > 0 ? (ch.revenue / summary.totals.businessRevenue) * 100 : 0
            return (
              <div key={ch.key} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[ch.key] }} />
                  <span className="text-xs font-medium text-gray-500">{ch.label}</span>
                </div>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(ch.revenue)}</p>
                <p className="text-xs text-gray-400">
                  {pct.toFixed(1)}% · {ch.units} pairs · {ch.orders} orders
                </p>
                {ch.sublocations?.map((s) => (
                  <p key={s.name} className="text-[11px] text-gray-400 mt-1">
                    {s.name}: {formatCurrency(s.revenue)}
                  </p>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Trend */}
      <SectionCard title="Revenue by channel">
        <div className="flex justify-end mb-2">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {(['daily', 'weekly'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={cn('px-3 py-1.5', granularity === g ? 'bg-[#0A0A0A] text-white' : 'bg-white text-gray-500')}
              >
                {g === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {activeChannels.map((ch) => (
              <Bar key={ch.key} dataKey={ch.key} name={ch.label} stackId="rev" fill={CHANNEL_COLORS[ch.key]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top SKUs */}
        <SectionCard title="Top SKUs (all channels)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400">
                <tr>
                  <th className="text-left font-medium pb-2">SKU</th>
                  <th className="text-right font-medium pb-2">Pairs</th>
                  <th className="text-right font-medium pb-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {summary?.topSkus.map((s) => (
                  <tr key={`${s.sku}-${s.name}`} className="border-t border-gray-50">
                    <td className="py-2">
                      <p className="font-medium text-gray-900">{s.sku}</p>
                      <p className="text-xs text-gray-400 max-w-[220px] truncate">{s.name}</p>
                    </td>
                    <td className="py-2 text-right text-gray-600">{s.units}</td>
                    <td className="py-2 text-right font-medium text-gray-900">{formatCurrency(s.revenue)}</td>
                  </tr>
                ))}
                {!summary?.topSkus.length && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-gray-400">No sales in this period</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Consignment stores */}
        <SectionCard title="Consignment stores — top & bottom">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(['top', 'bottom'] as const).map((side) => (
              <div key={side}>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{side === 'top' ? 'Top 10' : 'Bottom 10'}</p>
                <div className="space-y-1.5">
                  {summary?.consignmentStores[side].map((s) => (
                    <div key={s.storeCode} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 truncate max-w-[140px]">{s.storeName}</span>
                      <span className="text-right">
                        <span className="font-medium text-gray-900">{formatCurrency(s.revenue)}</span>
                        <span className="block text-[11px] text-gray-400">Xocks: {formatCurrency(s.xocksRevenue)}</span>
                      </span>
                    </div>
                  ))}
                  {!summary?.consignmentStores[side].length && (
                    <p className="text-sm text-gray-400">No consignment sales</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Events */}
      <SectionCard title="Booth events" icon={CalendarDays}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr>
                <th className="text-left font-medium pb-2">Event</th>
                <th className="text-left font-medium pb-2">Dates</th>
                <th className="text-right font-medium pb-2">Pairs</th>
                <th className="text-right font-medium pb-2">Shopify revenue</th>
                <th className="text-right font-medium pb-2">Target (T2)</th>
                <th className="text-right font-medium pb-2">Cover</th>
              </tr>
            </thead>
            <tbody>
              {summary?.events.map((ev) => (
                <tr key={ev.id} className="border-t border-gray-50">
                  <td className="py-2 font-medium text-gray-900">
                    {ev.name}
                    {ev.status === 'active' && (
                      <span className="ml-2 text-[10px] font-semibold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">LIVE</span>
                    )}
                  </td>
                  <td className="py-2 text-gray-500 whitespace-nowrap">{ev.dates}</td>
                  <td className="py-2 text-right text-gray-600">{ev.unitsSold}</td>
                  <td className="py-2 text-right font-medium text-gray-900">{formatCurrency(ev.shopifyRevenue)}</td>
                  <td className="py-2 text-right text-gray-600">
                    {ev.target != null ? formatCurrency(ev.target) : <span className="text-gray-300">no target linked</span>}
                  </td>
                  <td className="py-2 text-right">
                    {ev.coverRatio != null ? (
                      <span className={cn('font-medium', ev.coverRatio >= 1 ? 'text-emerald-600' : 'text-orange-500')}>
                        {(ev.coverRatio * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!summary?.events.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-gray-400">No events in this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Meta Ads — sample until Phase 2 */}
      <SectionCard title="Meta Ads" icon={Megaphone} sample={summary?.meta.sample}>
        {summary && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-400">Spend</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(summary.meta.spend)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Platform ROAS</p>
                <p className="text-lg font-bold text-gray-900">{summary.meta.platformRoas.toFixed(2)}×</p>
                <p className="text-[11px] text-gray-400">Meta-attributed</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Blended ROAS</p>
                <p className="text-lg font-bold text-gray-900">{blendedRoas != null ? `${blendedRoas.toFixed(2)}×` : '—'}</p>
                <p className="text-[11px] text-gray-400">Online channels ÷ spend</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Purchases</p>
                <p className="text-lg font-bold text-gray-900">{summary.meta.purchases}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([['Best assets', summary.meta.topAds], ['Worst assets', summary.meta.worstAds]] as const).map(([label, ads]) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{label}</p>
                  <div className="space-y-1.5">
                    {ads.map((ad) => (
                      <div key={ad.name} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 truncate max-w-[200px]">{ad.name}</span>
                        <span className={cn('font-medium', ad.roas >= 1 ? 'text-emerald-600' : 'text-red-500')}>
                          {ad.roas.toFixed(1)}× · {formatCurrency(ad.spend)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>

      {/* Organic content — sample until Phase 3 */}
      <SectionCard title="Organic content" icon={Sparkles} sample={summary?.organic.sample}>
        {summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([['Good content', summary.organic.goodPosts, 'text-emerald-600'], ['Needs improvement', summary.organic.badPosts, 'text-red-500']] as const).map(
              ([label, posts, color]) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{label}</p>
                  <div className="space-y-2">
                    {posts.map((p) => (
                      <div key={p.caption} className="text-sm">
                        <p className="text-gray-700 truncate">{p.caption}</p>
                        <p className="text-xs text-gray-400">
                          {p.platform} · {p.mediaType} ·{' '}
                          <span className={cn('font-medium', color)}>
                            {p.reach.toLocaleString()} reach · {p.engagementRate.toFixed(1)}% eng
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
        {summary && (
          <p className="text-xs text-gray-400 mt-3">
            Benchmark: median reach {summary.organic.medianReach.toLocaleString()} over the last {summary.organic.periodDays} days
          </p>
        )}
      </SectionCard>

      {/* Marketplace upload */}
      <div>
        {summary && (
          <p className="text-xs text-gray-400 mb-2">
            {(['shopee', 'tiktok'] as const).map((p) => {
              const u = summary.freshness.lastMarketplaceUpload[p]
              return (
                <span key={p} className="mr-4">
                  {p === 'shopee' ? 'Shopee' : 'TikTok'}: {u ? `data to ${u.dataTo ?? '?'} (uploaded ${freshnessText(u.uploadedAt)})` : 'no uploads yet'}
                </span>
              )
            })}
          </p>
        )}
        <MarketplaceUploadCard onUploaded={fetchSummary} />
      </div>
    </div>
  )
}
