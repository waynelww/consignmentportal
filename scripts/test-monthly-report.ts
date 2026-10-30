// Unit test for the monthly report rules: scope (active, non-test stores),
// sales bands, headline month-on-month figures, action cards, watch list and
// new stores. Pure fixtures, no database.
// Run: npx tsx scripts/test-monthly-report.ts
import assert from 'node:assert/strict'
import { computeMonthlyReport, salesBand, type ReportInput, type RawStore } from '../lib/monthly-report/compute'
import { parseMonthlyReportSettings, bandLabels } from '../lib/monthly-report/settings'
import { monthRange, previousMonthOf, shiftMonth, dayLabel } from '../lib/monthly-report/months'

// ── Settings ────────────────────────────────────────────────────────────────
const defaults = parseMonthlyReportSettings([])
assert.deepEqual(defaults, { email: null, bandHigh: 250, bandMid: 100, lowStockPct: 50, reminderDays: 7 })
assert.equal(parseMonthlyReportSettings([{ key: 'monthly_report_email', value: '  ops@example.com ' }]).email, 'ops@example.com')
assert.equal(parseMonthlyReportSettings([{ key: 'monthly_report_email', value: '   ' }]).email, null, 'blank email is not a recipient')
const badBands = parseMonthlyReportSettings([
  { key: 'monthly_report_band_high', value: '100' },
  { key: 'monthly_report_band_mid', value: '150' },
])
assert.deepEqual([badBands.bandHigh, badBands.bandMid], [250, 100], 'mid >= high falls back to defaults')
const custom = parseMonthlyReportSettings([
  { key: 'monthly_report_band_high', value: '300' },
  { key: 'monthly_report_band_mid', value: '150' },
  { key: 'sales_reminder_days', value: '10' },
  { key: 'low_stock_pct', value: '40' },
])
assert.deepEqual(bandLabels(custom), { high: 'RM300 and above', mid: 'RM150 – RM299', low: 'Below RM150' })
assert.equal(custom.reminderDays, 10)
assert.equal(custom.lowStockPct, 40)

// ── Months ──────────────────────────────────────────────────────────────────
assert.equal(previousMonthOf('2026-10-30'), '2026-09')
assert.equal(previousMonthOf('2026-01-01'), '2025-12')
assert.equal(shiftMonth('2026-09', 1), '2026-10')
assert.deepEqual(monthRange('2026-09'), { start: '2026-09-01', end: '2026-09-30', nextStart: '2026-10-01' })
assert.equal(monthRange('2028-02').end, '2028-02-29', 'leap year')
assert.equal(dayLabel('2026-10-07'), '7 Oct 2026')

// ── Bands ───────────────────────────────────────────────────────────────────
assert.equal(salesBand(250, { bandHigh: 250, bandMid: 100 }), 'high')
assert.equal(salesBand(249.99, { bandHigh: 250, bandMid: 100 }), 'mid')
assert.equal(salesBand(100, { bandHigh: 250, bandMid: 100 }), 'mid')
assert.equal(salesBand(99.99, { bandHigh: 250, bandMid: 100 }), 'low')
assert.equal(salesBand(0, { bandHigh: 250, bandMid: 100 }), 'low')

// ── Fixture: September 2026 report, run on 30 Oct 2026 ──────────────────────
const created = (day: string) => `${day}T08:00:00+08:00`
const store = (id: string, code: string, name: string, type: string, city: string, day: string, plan = false, status = 'active'): RawStore => ({
  id, store_code: code, store_name: name, store_type: type, city, status,
  created_at: created(day), on_stock_plan: plan, opened_by_member_id: null,
})

const stores: RawStore[] = [
  store('a', 'STR-015', 'Hyprground Holding', 'sports_store', 'Kuala Lumpur', '2025-06-01', true),
  store('b', 'STR-013', 'Montanic Suria Sabah', 'sports_store', 'Kota Kinabalu', '2025-06-01'),
  store('c', 'STR-016', 'Duke Hotels', 'hotel', 'Kuala Lumpur', '2025-07-01'),
  store('d', 'AGK-001', 'Wayne Store', 'barbershop', 'Kuala Lumpur', '2025-01-01'),
  store('e', 'STR-010', 'Kemsite', 'clothing', 'Kuala Lumpur', '2026-08-01'),
  store('f', 'STR-021', 'Oribags', 'clothing', 'Shah Alam', '2026-09-23'),
  store('g', 'STR-009', 'Vaernand store', 'barbershop', 'Kuala Lumpur', '2025-01-01'),
  store('h', 'STR-099', 'Closed Store', 'sports_store', 'Ipoh', '2025-03-01', false, 'inactive'),
  store('i', 'STR-012', 'Burrow Skateshop', 'skate_shop', 'Kuala Lumpur', '2025-02-01'),
]
stores[5].opened_by_member_id = 'tm1'

const sale = (store_id: string, sale_date: string, quantity: number, total_amount: number) => ({ store_id, sale_date, quantity, total_amount })

const input: ReportInput = {
  ym: '2026-09',
  today: '2026-10-30',
  settings: { ...defaults, email: 'waynelww2000@gmail.com' },
  stores,
  testStoreIds: new Set(['g']),
  storeTypeLabels: new Map([
    ['sports_store', 'Sports Store'], ['hotel', 'Hotel'], ['barbershop', 'Barbershop'],
    ['clothing', 'Clothing Store'], ['skate_shop', 'Skate Shop'],
  ]),
  teamNames: new Map([['tm1', 'Aiman']]),
  sales: [
    sale('a', '2026-09-03', 9, 639.65), sale('a', '2026-08-10', 8, 500),
    sale('b', '2026-09-12', 7, 545.61),
    sale('c', '2026-09-20', 2, 139.9),
    sale('i', '2026-08-18', 1, 50),
    sale('g', '2026-09-05', 5, 500), // test account: must not count
    sale('h', '2026-09-05', 4, 400), // inactive store: must not count
  ],
  periods: [
    { store_id: 'a', period_year: 2026, period_month: 9, status: 'paid', xocks_revenue: 447.76 },
    { store_id: 'b', period_year: 2026, period_month: 9, status: 'pending', xocks_revenue: 381.93 },
    { store_id: 'c', period_year: 2026, period_month: 9, status: 'pending', xocks_revenue: 97.93 },
    { store_id: 'g', period_year: 2026, period_month: 9, status: 'pending', xocks_revenue: 350 }, // test
    { store_id: 'a', period_year: 2026, period_month: 8, status: 'paid', xocks_revenue: 350 },
    { store_id: 'i', period_year: 2026, period_month: 8, status: 'paid', xocks_revenue: 35 },
  ],
  stock: new Map([
    ['a', { onHand: 82, stocked: 180, pct: 46, needsRestock: true }],
    ['b', { onHand: 1, stocked: 150, pct: 1, needsRestock: true }],
    ['d', { onHand: 2, stocked: 36, pct: 6, needsRestock: true }],
  ]),
  lastSaleDate: new Map([
    ['a', '2026-10-27'], ['b', '2026-10-29'], ['c', '2026-09-24'], ['d', '2026-08-30'],
    ['i', '2026-08-20'],
  ]),
  firstSaleDate: new Map(),
  starterStock: new Map([['f', 48]]),
}

const r = computeMonthlyReport(input)

// Scope and headline
assert.equal(r.periodLabel, '1–30 Sep 2026')
assert.equal(r.monthLabel, 'September 2026')
assert.equal(r.prevMonthLabel, 'August 2026')
assert.equal(r.paymentDueLabel, '7 Oct 2026')
assert.deepEqual(r.headline.activeStores, { value: 7, prev: 6 })
assert.deepEqual(r.headline.newStores, { value: 1, prev: 1 })
assert.deepEqual(r.headline.sales, { value: 1325.16, prev: 550 })
assert.deepEqual(r.headline.pairs, { value: 18, prev: 9 })
assert.deepEqual(r.headline.xocksRevenue, { value: 927.62, prev: 385 })
assert.equal(r.headline.invoicesPaid, 1)
assert.equal(r.headline.invoicesPending, 2)
assert.equal(r.headline.pendingRm, 479.86)
assert.equal(r.stores.length, 7, 'test and inactive stores are out of scope')
assert.ok(!r.stores.some((s) => s.code === 'STR-009' || s.code === 'STR-099'))

// Bands
assert.deepEqual(r.bands.map((b) => b.stores.length), [2, 1, 4])
assert.deepEqual(r.bands.map((b) => b.total), [1185.26, 139.9, 0])
assert.deepEqual(r.bands.map((b) => b.label), ['RM250 and above', 'RM100 – RM249', 'Below RM100'])

// Categories: biggest total first, then by name
assert.deepEqual(r.categories.map((c) => c.label), ['Sports Store', 'Hotel', 'Barbershop', 'Clothing Store', 'Skate Shop'])
assert.deepEqual(r.categories[0], { value: 'sports_store', label: 'Sports Store', stores: 2, total: 1185.26, average: 592.63 })

// Action plan
const card = (key: string) => r.actions.find((a) => a.key === key)!
assert.deepEqual(card('restock').rows.map((x) => x.code), ['STR-013', 'AGK-001', 'STR-015'], 'lowest stock % first')
assert.deepEqual(card('restock').rows.map((x) => x.metric), ['1 of 150 pairs (1%)', '2 of 36 pairs (6%)', '82 of 180 pairs (46%)'])
assert.deepEqual(card('below').rows.map((x) => x.code), ['AGK-001', 'STR-010', 'STR-012', 'STR-021'])
assert.ok(card('below').rows.every((x) => x.metric === 'No sales'))
assert.deepEqual(card('not_keying').rows.map((x) => x.metric), ['Never keyed in', '71 days', '61 days', 'Never keyed in', '36 days'])
assert.equal(card('not_keying').title, 'Not keying in sales for 7+ days — chase them')
assert.deepEqual(card('push').rows.map((x) => x.code), ['STR-016'])
assert.deepEqual(card('push').rows.map((x) => x.metric), ['RM139.90'])
assert.deepEqual(card('keep').rows.map((x) => x.metric), ['RM639.65 · 4-month plan', 'RM545.61'])
assert.deepEqual(card('keep').rows.map((x) => x.onPlan), [true, false])
assert.equal(card('restock').tone, 'red')
assert.equal(card('push').badge, 'THIS WEEK')
assert.equal(card('keep').badge, 'KEEP GOING')

// Watch list: every store with a red or amber flag, lowest sales first
assert.deepEqual(r.watch.map((w) => w.code), ['AGK-001', 'STR-010', 'STR-012', 'STR-021', 'STR-016', 'STR-013', 'STR-015'])
assert.deepEqual(r.watch[0].reasons, ['Restock: 2 of 36 pairs (6%)', 'No sales this month', 'No sale entered for 61 days'])

// New stores
assert.equal(r.newStores.length, 1)
assert.deepEqual(r.newStores[0], {
  code: 'STR-021', name: 'Oribags', category: 'Clothing Store', city: 'Shah Alam', openedOn: '2026-09-23',
  openedBy: 'Aiman', starterStock: 48, firstSaleDate: null, sales: 0,
})

// Test accounts never leak into the store lists
assert.equal(r.stores.find((s) => s.code === 'STR-015')!.sales, 639.65)

console.log('monthly report rules: all checks passed')
