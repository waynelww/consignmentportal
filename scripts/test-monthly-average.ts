// Unit test for the Monthly Average report maths (calendar months, opening
// month, partial last month, blanks).
// Run: npx tsx scripts/test-monthly-average.ts
import assert from 'node:assert/strict'
import {
  buildMonthlyAverage, monthlyAverageWindow, shiftMonthKey, isMonthlyAverageMonths,
  type MonthlyAverageStore, type MonthlyAverageSale,
} from '../lib/reports/monthly-average'

// ── Month arithmetic ──────────────────────────────────────────────────────
assert.equal(shiftMonthKey('2026-01', -1), '2025-12')
assert.equal(shiftMonthKey('2026-10', -12), '2025-10')
assert.equal(shiftMonthKey('2026-03', 2), '2026-05')

// ── Window: last N full months, current month excluded ───────────────────
const w3 = monthlyAverageWindow('2026-10-29', 3)
assert.deepEqual(w3.month_keys, ['2026-07', '2026-08', '2026-09'])
assert.equal(w3.last_month, '2026-09')
assert.equal(w3.from, '2026-07-01')
assert.equal(w3.to, '2026-09-30')

const w1 = monthlyAverageWindow('2026-01-05', 1)
assert.deepEqual(w1.month_keys, ['2025-12'])
assert.equal(w1.to, '2025-12-31')

const w12 = monthlyAverageWindow('2026-10-29', 12)
assert.equal(w12.month_keys.length, 12)
assert.equal(w12.month_keys[0], '2025-10')
assert.equal(w12.to, '2026-09-30')

assert.ok(isMonthlyAverageMonths(6))
assert.ok(!isMonthlyAverageMonths(4))

// ── Averages ──────────────────────────────────────────────────────────────
const stores: MonthlyAverageStore[] = [
  { id: 'a', store_code: 'AAA-1', store_name: 'Full year', store_type: 'barbershop', state: 'Johor', status: 'active' },
  { id: 'b', store_code: 'BBB-1', store_name: 'Opened in Aug', store_type: 'gym', state: 'Selangor', status: 'active' },
  { id: 'c', store_code: 'CCC-1', store_name: 'Never sold', store_type: 'gym', state: 'Selangor', status: 'active' },
  { id: 'd', store_code: 'DDD-1', store_name: 'Closed', store_type: 'shoe_store', state: 'Johor', status: 'inactive' },
  { id: 'e', store_code: 'EEE-1', store_name: 'Opens Oct', store_type: 'shoe_store', state: 'Johor', status: 'active' },
]

const sales: MonthlyAverageSale[] = [
  // a: sales in Jan (before window) and Jul, Aug, Sep, plus Oct (must be ignored)
  { store_id: 'a', sale_date: '2026-01-10', quantity: 5, total_amount: 100 },
  { store_id: 'a', sale_date: '2026-07-03', quantity: 10, total_amount: 300 },
  { store_id: 'a', sale_date: '2026-08-20', quantity: 20, total_amount: 600 },
  { store_id: 'a', sale_date: '2026-09-01', quantity: 30, total_amount: 900 },
  { store_id: 'a', sale_date: '2026-09-30', quantity: 0, total_amount: 0 },
  { store_id: 'a', sale_date: '2026-10-02', quantity: 99, total_amount: 9999 },
  // b: first sale 2026-08-15, so the window's July is not counted
  { store_id: 'b', sale_date: '2026-08-15', quantity: 4, total_amount: 120 },
  { store_id: 'b', sale_date: '2026-09-10', quantity: 6, total_amount: 180 },
  // d: inactive but has sales, included when the page asks for inactive stores
  { store_id: 'd', sale_date: '2026-06-01', quantity: 2, total_amount: 60 },
  { store_id: 'd', sale_date: '2026-07-01', quantity: 2, total_amount: 60 },
  { store_id: 'd', sale_date: '2026-07-20', quantity: 2, total_amount: 60 },
]

const { window: win, rows } = buildMonthlyAverage({ asOf: '2026-10-29', months: 3, stores, sales })
assert.deepEqual(win.month_keys, ['2026-07', '2026-08', '2026-09'])
const byId = new Map(rows.map((r) => [r.store_id, r]))

// a: full 3 months. total 300+600+900 = 1800 over 3 = 600 avg; pairs 60/3 = 20
const a = byId.get('a')!
assert.equal(a.open_month, '2026-01')
assert.equal(a.months_counted, 3)
assert.equal(a.total_rm, 1800)
assert.equal(a.total_pairs, 60)
assert.equal(a.avg_rm, 600)
assert.equal(a.avg_pairs, 20)
assert.equal(a.last_month_rm, 900)
// change: last month vs average of the EARLIER months (Jul, Aug) = 450
assert.equal(a.baseline_months, 2)
assert.equal(a.baseline_avg_rm, 450)
assert.equal(a.change_pct, 100, '900 vs earlier avg 450 = +100%')

// b: opened Aug, so 2 months counted. total 300 / 2 = 150; last month 180
const b = byId.get('b')!
assert.equal(b.open_month, '2026-08')
assert.equal(b.months_counted, 2)
assert.equal(b.avg_rm, 150)
assert.equal(b.avg_pairs, 5)
assert.equal(b.total_rm, 300)
assert.equal(b.last_month_rm, 180)
// earlier counted months = Aug only (opened Aug): 180 vs 120 = +50%
assert.equal(b.baseline_months, 1)
assert.equal(b.baseline_avg_rm, 120)
assert.equal(b.change_pct, 50, '180 vs earlier avg 120 = +50%')

// c: no sales ever → blanks, zero months, sorted last by the page
const c = byId.get('c')!
assert.equal(c.open_month, null)
assert.equal(c.months_counted, 0)
assert.equal(c.avg_rm, null)
assert.equal(c.avg_pairs, null)
assert.equal(c.change_pct, null)

// e: no sales in window or before → nothing counted
assert.equal(byId.get('e')!.months_counted, 0)

// d: sold in Jun and Jul (before the window) → 3 months counted, Jun ignored in months, Jul in window
const d = byId.get('d')!
assert.equal(d.open_month, '2026-06')
assert.equal(d.months_counted, 3)
assert.equal(d.total_rm, 120, 'only Jul sales are in the window: 60 + 60')
assert.equal(d.last_month_rm, 0)
// earlier months Jul (120) and Aug (0): average 60, last month 0 = -100%
assert.equal(d.baseline_months, 2)
assert.equal(d.baseline_avg_rm, 60)
assert.equal(d.change_pct, -100)

// Zero average: change is null, not a divide-by-zero
const zero = buildMonthlyAverage({
  asOf: '2026-10-29', months: 1,
  stores: [{ id: 'z', store_code: 'Z', store_name: 'Z', store_type: 'gym', state: 'Perak', status: 'active' }],
  sales: [{ store_id: 'z', sale_date: '2026-08-01', quantity: 0, total_amount: 0 }],
}).rows[0]
assert.equal(zero.avg_rm, 0)
assert.equal(zero.change_pct, null)

// 1-month selection: compared against the month before last month (Aug)
const oneRows = buildMonthlyAverage({ asOf: '2026-10-29', months: 1, stores, sales }).rows
const one = oneRows.find((r) => r.store_id === 'a')!
assert.equal(one.avg_rm, 900)
assert.equal(one.baseline_months, 1)
assert.equal(one.baseline_avg_rm, 600)
assert.equal(one.change_pct, 50, '900 vs Aug 600 = +50%')

// b opened Aug, so Aug is a valid comparison month for its 1-month change
assert.equal(oneRows.find((r) => r.store_id === 'b')!.change_pct, 50, '180 vs Aug 120 = +50%')

// Store opened in the last month: nothing earlier to compare with → no change
const newStore = buildMonthlyAverage({
  asOf: '2026-10-29', months: 3,
  stores: [{ id: 'f', store_code: 'FFF-1', store_name: 'New', store_type: 'gym', state: 'Perak', status: 'active' }],
  sales: [{ store_id: 'f', sale_date: '2026-09-05', quantity: 3, total_amount: 90 }],
}).rows[0]
assert.equal(newStore.open_month, '2026-09')
assert.equal(newStore.months_counted, 1)
assert.equal(newStore.avg_rm, 90)
assert.equal(newStore.baseline_months, 0)
assert.equal(newStore.change_pct, null)

// 1-month selection for a store opened in the last month: the month before predates opening
const newOne = buildMonthlyAverage({
  asOf: '2026-10-29', months: 1,
  stores: [{ id: 'f', store_code: 'FFF-1', store_name: 'New', store_type: 'gym', state: 'Perak', status: 'active' }],
  sales: [{ store_id: 'f', sale_date: '2026-09-05', quantity: 3, total_amount: 90 }],
}).rows[0]
assert.equal(newOne.baseline_months, 0)
assert.equal(newOne.change_pct, null)

console.log('monthly-average: all assertions passed')
