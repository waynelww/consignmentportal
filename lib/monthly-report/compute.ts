// The monthly report model: every number and list in the PDF and the Excel
// file comes from computeMonthlyReport(). Pure: the loader (load.ts) reads the
// database, this file only does the arithmetic and the rules, so the test
// script can pin it with fixtures.
//
// Scope: "in scope" = an active store that is not a test account (shared
// helper in lib/stores/test-accounts.ts). Every total, band, category, action
// and invoice figure uses that scope. Month-on-month "active stores" and
// "new stores" are counted on the same rule.

import { isTestStore } from '../stores/test-accounts'
import { storeSaleAge, todayMYT } from '../sales/last-sale'
import { monthRange, monthLabel, monthShort, shiftMonth, dayLabel, type MonthRange } from './months'
import { bandLabels, type MonthlyReportSettings } from './settings'

// ── Raw inputs (filled by load.ts) ──────────────────────────────────────────

export interface RawStore {
  id: string
  store_code: string
  store_name: string
  city: string | null
  store_type: string | null
  status: string
  created_at: string
  on_stock_plan: boolean
  opened_by_member_id: string | null
}

export interface RawSale {
  store_id: string
  quantity: number
  total_amount: number
  sale_date: string
}

export interface RawPeriod {
  store_id: string
  period_year: number
  period_month: number
  status: string
  xocks_revenue: number
}

export interface StockFigures {
  onHand: number
  stocked: number
  pct: number | null
  needsRestock: boolean
}

export interface ReportInput {
  /** Report month, YYYY-MM. */
  ym: string
  /** Malaysia-time day the report is generated, YYYY-MM-DD. Drives "days since sale". */
  today: string
  settings: MonthlyReportSettings
  stores: RawStore[]
  testStoreIds: ReadonlySet<string>
  storeTypeLabels: ReadonlyMap<string, string>
  teamNames: ReadonlyMap<string, string>
  /** Sales for the report month and the month before it. */
  sales: RawSale[]
  /** Commission periods for the report month and the month before it. */
  periods: RawPeriod[]
  stock: ReadonlyMap<string, StockFigures>
  lastSaleDate: ReadonlyMap<string, string>
  firstSaleDate: ReadonlyMap<string, string>
  /** Pairs received on the store's initial delivery, for new stores. */
  starterStock: ReadonlyMap<string, number>
}

// ── Report model ────────────────────────────────────────────────────────────

export type SalesBand = 'high' | 'mid' | 'low'
export type ActionTone = 'red' | 'amber' | 'green'

export interface ReportStore {
  id: string
  code: string
  name: string
  city: string
  categoryValue: string
  category: string
  onPlan: boolean
  /** Malaysia-time day the store was opened, YYYY-MM-DD. */
  openedOn: string
  sales: number
  pairs: number
  band: SalesBand
  stock: StockFigures | null
  lastSaleDate: string | null
  daysSinceSale: number
  neverSold: boolean
}

export interface Compare {
  value: number
  prev: number
}

export interface Headline {
  activeStores: Compare
  newStores: Compare
  sales: Compare
  pairs: Compare
  xocksRevenue: Compare
  invoicesPaid: number
  invoicesPending: number
  pendingRm: number
}

export interface BandSummary {
  key: SalesBand
  label: string
  tone: ActionTone
  stores: ReportStore[]
  total: number
}

export interface CategorySummary {
  value: string
  label: string
  stores: number
  total: number
  average: number
}

export interface ActionRow {
  code: string
  name: string
  category: string
  metric: string
  onPlan: boolean
}

export interface ActionCard {
  key: 'restock' | 'below' | 'not_keying' | 'push' | 'keep'
  tone: ActionTone
  badge: 'ACT NOW' | 'THIS WEEK' | 'KEEP GOING'
  title: string
  rows: ActionRow[]
}

export interface WatchRow {
  code: string
  name: string
  category: string
  city: string
  sales: number
  band: SalesBand
  reasons: string[]
}

export interface NewStoreRow {
  code: string
  name: string
  category: string
  city: string
  openedOn: string
  openedBy: string | null
  starterStock: number
  firstSaleDate: string | null
  sales: number
}

export interface MonthlyReport {
  ym: string
  monthLabel: string
  prevMonthLabel: string
  prevMonthShort: string
  range: MonthRange
  /** "1–30 Sep 2026" */
  periodLabel: string
  /** Day stores must transfer Xocks revenue, e.g. "7 Oct 2026". */
  paymentDueLabel: string
  today: string
  settings: MonthlyReportSettings
  bandLabels: ReturnType<typeof bandLabels>
  headline: Headline
  bands: BandSummary[]
  categories: CategorySummary[]
  /** Every in-scope store, biggest sales first. Feeds the Excel "Existing Stores" tab. */
  stores: ReportStore[]
  newStores: NewStoreRow[]
  actions: ActionCard[]
  watch: WatchRow[]
}

// ── Pure helpers ────────────────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Malaysia-time day a timestamp falls on, YYYY-MM-DD. */
export function createdOnMYT(iso: string): string {
  return todayMYT(new Date(iso))
}

export function salesBand(total: number, s: Pick<MonthlyReportSettings, 'bandHigh' | 'bandMid'>): SalesBand {
  if (total >= s.bandHigh) return 'high'
  if (total >= s.bandMid) return 'mid'
  return 'low'
}

function money(n: number): string {
  return `RM${round2(n).toFixed(2)}`
}

// ── Compute ─────────────────────────────────────────────────────────────────

export function computeMonthlyReport(input: ReportInput): MonthlyReport {
  const { ym, today, settings } = input
  const cur = monthRange(ym)
  const prevYm = shiftMonth(ym, -1)
  const prev = monthRange(prevYm)
  const prevMonthShortLabel = monthShort(prevYm)
  const labels = bandLabels(settings)
  const typeLabel = (value: string | null) => {
    if (!value) return 'Uncategorised'
    return input.storeTypeLabels.get(value) ?? value
  }

  const nonTest = input.stores.filter((s) => !isTestStore(input.testStoreIds, s.id))
  const inScope = nonTest.filter((s) => s.status === 'active')
  const inScopeIds = new Set(inScope.map((s) => s.id))

  // Sales per store for the report month and the month before.
  const curBy = new Map<string, { sales: number; pairs: number }>()
  const prevBy = new Map<string, { sales: number; pairs: number }>()
  for (const r of input.sales) {
    if (!inScopeIds.has(r.store_id)) continue
    const target = r.sale_date >= cur.start && r.sale_date <= cur.end ? curBy
      : r.sale_date >= prev.start && r.sale_date <= prev.end ? prevBy
      : null
    if (!target) continue
    const m = target.get(r.store_id) ?? { sales: 0, pairs: 0 }
    m.sales += Number(r.total_amount)
    m.pairs += Number(r.quantity)
    target.set(r.store_id, m)
  }

  const stores: ReportStore[] = inScope.map((s) => {
    const m = curBy.get(s.id) ?? { sales: 0, pairs: 0 }
    const sales = round2(m.sales)
    const lastSaleDate = input.lastSaleDate.get(s.id) ?? null
    const age = storeSaleAge(lastSaleDate, s.created_at, today)
    return {
      id: s.id,
      code: s.store_code,
      name: s.store_name,
      city: s.city ?? '',
      categoryValue: s.store_type ?? '',
      category: typeLabel(s.store_type),
      onPlan: s.on_stock_plan,
      openedOn: createdOnMYT(s.created_at),
      sales,
      pairs: m.pairs,
      band: salesBand(sales, settings),
      stock: input.stock.get(s.id) ?? null,
      lastSaleDate,
      daysSinceSale: age?.days ?? 0,
      neverSold: age?.neverSold ?? true,
    }
  }).sort((a, b) => b.sales - a.sales || a.code.localeCompare(b.code))

  // ── Headline numbers ──────────────────────────────────────────────────────
  const sumSales = (m: Map<string, { sales: number }>) => round2([...m.values()].reduce((t, v) => t + v.sales, 0))
  const sumPairs = (m: Map<string, { pairs: number }>) => [...m.values()].reduce((t, v) => t + v.pairs, 0)

  const storesBefore = (day: string) => inScope.filter((s) => createdOnMYT(s.created_at) < day).length
  const storesOpenedIn = (r: MonthRange) => inScope.filter((s) => {
    const d = createdOnMYT(s.created_at)
    return d >= r.start && d <= r.end
  }).length

  const curPeriods = input.periods.filter((p) => inScopeIds.has(p.store_id) && p.period_year === Number(ym.slice(0, 4)) && p.period_month === Number(ym.slice(5, 7)))
  const prevPeriods = input.periods.filter((p) => inScopeIds.has(p.store_id) && p.period_year === Number(prevYm.slice(0, 4)) && p.period_month === Number(prevYm.slice(5, 7)))
  const paid = curPeriods.filter((p) => p.status === 'paid')
  const pending = curPeriods.filter((p) => p.status !== 'paid')

  const headline: Headline = {
    activeStores: { value: storesBefore(cur.nextStart), prev: storesBefore(cur.start) },
    newStores: { value: storesOpenedIn(cur), prev: storesOpenedIn(prev) },
    sales: { value: sumSales(curBy), prev: sumSales(prevBy) },
    pairs: { value: sumPairs(curBy), prev: sumPairs(prevBy) },
    xocksRevenue: {
      value: round2(curPeriods.reduce((t, p) => t + Number(p.xocks_revenue), 0)),
      prev: round2(prevPeriods.reduce((t, p) => t + Number(p.xocks_revenue), 0)),
    },
    invoicesPaid: paid.length,
    invoicesPending: pending.length,
    pendingRm: round2(pending.reduce((t, p) => t + Number(p.xocks_revenue), 0)),
  }

  // ── Bands ─────────────────────────────────────────────────────────────────
  const bandOf = (key: SalesBand, label: string, tone: ActionTone): BandSummary => {
    const list = stores.filter((s) => s.band === key)
    return { key, label, tone, stores: list, total: round2(list.reduce((t, s) => t + s.sales, 0)) }
  }
  const bands: BandSummary[] = [
    bandOf('high', labels.high, 'green'),
    bandOf('mid', labels.mid, 'amber'),
    bandOf('low', labels.low, 'red'),
  ]

  // ── Categories (store type) ───────────────────────────────────────────────
  const byType = new Map<string, { label: string; stores: number; total: number }>()
  for (const s of stores) {
    const c = byType.get(s.categoryValue) ?? { label: s.category, stores: 0, total: 0 }
    c.stores += 1
    c.total = round2(c.total + s.sales)
    byType.set(s.categoryValue, c)
  }
  const categories: CategorySummary[] = [...byType.entries()]
    .map(([value, c]) => ({ value, label: c.label, stores: c.stores, total: c.total, average: round2(c.total / c.stores) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))

  // ── Action plan (rule-based, one card per action) ─────────────────────────
  const restock = stores
    .filter((s) => s.stock?.needsRestock)
    .sort((a, b) => (a.stock?.pct ?? 100) - (b.stock?.pct ?? 100) || a.code.localeCompare(b.code))
  const low = bands.find((b) => b.key === 'low')!.stores
  const notKeying = stores
    .filter((s) => s.daysSinceSale >= settings.reminderDays)
    .sort((a, b) => b.daysSinceSale - a.daysSinceSale || a.code.localeCompare(b.code))
  const mid = bands.find((b) => b.key === 'mid')!.stores
  const high = bands.find((b) => b.key === 'high')!.stores

  const row = (s: ReportStore, metric: string): ActionRow => ({
    code: s.code, name: s.name, category: s.category, metric, onPlan: s.onPlan,
  })

  const actions: ActionCard[] = [
    {
      key: 'restock',
      tone: 'red',
      badge: 'ACT NOW',
      title: `Restock — stock below ${settings.lowStockPct}% of stocked level`,
      rows: restock.map((s) => row(s, `${s.stock!.onHand} of ${s.stock!.stocked} pairs (${s.stock!.pct ?? 0}%)`)),
    },
    {
      key: 'below',
      tone: 'red',
      badge: 'ACT NOW',
      title: `${labels.low} — call or visit`,
      rows: low.map((s) => row(s, s.sales > 0 ? money(s.sales) : 'No sales')),
    },
    {
      key: 'not_keying',
      tone: 'red',
      badge: 'ACT NOW',
      title: `Not keying in sales for ${settings.reminderDays}+ days — chase them`,
      rows: notKeying.map((s) => row(s, s.neverSold ? 'Never keyed in' : `${s.daysSinceSale} days`)),
    },
    {
      key: 'push',
      tone: 'amber',
      badge: 'THIS WEEK',
      title: `${labels.mid} — push to RM${settings.bandHigh}`,
      rows: mid.map((s) => row(s, money(s.sales))),
    },
    {
      key: 'keep',
      tone: 'green',
      badge: 'KEEP GOING',
      title: `${labels.high} — keep them stocked`,
      rows: high.map((s) => row(s, `${money(s.sales)}${s.onPlan ? ' · 4-month plan' : ''}`)),
    },
  ]

  // ── Watch list: every store with an act-now or this-week flag ─────────────
  const watchMap = new Map<string, WatchRow>()
  const flag = (s: ReportStore, reason: string) => {
    const w = watchMap.get(s.id) ?? { code: s.code, name: s.name, category: s.category, city: s.city, sales: s.sales, band: s.band, reasons: [] }
    w.reasons.push(reason)
    watchMap.set(s.id, w)
  }
  for (const s of restock) flag(s, `Restock: ${s.stock!.onHand} of ${s.stock!.stocked} pairs (${s.stock!.pct ?? 0}%)`)
  for (const s of low) flag(s, s.sales > 0 ? `Below RM${settings.bandMid}` : 'No sales this month')
  for (const s of notKeying) flag(s, s.neverSold ? 'Never keyed in' : `No sale entered for ${s.daysSinceSale} days`)
  for (const s of mid) flag(s, `RM${settings.bandMid}–RM${settings.bandHigh - 1}: push to RM${settings.bandHigh}`)
  const watch = [...watchMap.values()].sort((a, b) => a.sales - b.sales || a.code.localeCompare(b.code))

  // ── New stores opened this month ──────────────────────────────────────────
  const newStores: NewStoreRow[] = inScope
    .filter((s) => {
      const d = createdOnMYT(s.created_at)
      return d >= cur.start && d <= cur.end
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((s) => ({
      code: s.store_code,
      name: s.store_name,
      category: typeLabel(s.store_type),
      city: s.city ?? '',
      openedOn: createdOnMYT(s.created_at),
      openedBy: s.opened_by_member_id ? input.teamNames.get(s.opened_by_member_id) ?? null : null,
      starterStock: input.starterStock.get(s.id) ?? 0,
      firstSaleDate: input.firstSaleDate.get(s.id) ?? null,
      sales: round2(curBy.get(s.id)?.sales ?? 0),
    }))

  const lastDayNo = Number(cur.end.slice(8, 10))
  const dueDay = `${shiftMonth(ym, 1)}-07`

  return {
    ym,
    monthLabel: monthLabel(ym),
    prevMonthLabel: monthLabel(prevYm),
    prevMonthShort: prevMonthShortLabel,
    range: cur,
    periodLabel: `1–${lastDayNo} ${monthShort(ym)} ${ym.slice(0, 4)}`,
    paymentDueLabel: dayLabel(dueDay),
    today,
    settings,
    bandLabels: labels,
    headline,
    bands,
    categories,
    stores,
    newStores,
    actions,
    watch,
  }
}
