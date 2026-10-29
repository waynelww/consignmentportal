// Unit test for the low-stock rule and the 4-month plan allocation.
// Run: npx tsx scripts/test-low-stock.ts
import assert from 'node:assert/strict'
import {
  parseLowStockSettings, stockedLevel, lowThreshold, codeStatus, storeStockSummary,
  describeCode, formatStoreStock, DEFAULT_LOW_STOCK_SETTINGS,
} from '../lib/restock/low-stock'
import { allocateByShare } from '../lib/restock/wayne-calc'

// ── Settings ────────────────────────────────────────────────────────────
assert.deepEqual(parseLowStockSettings([]), DEFAULT_LOW_STOCK_SETTINGS)
assert.deepEqual(parseLowStockSettings([
  { key: 'low_stock_pct', value: '40' },
  { key: 'restock_plan_min_monthly_sales', value: '300' },
  { key: 'restock_plan_avg_months', value: '2' },
  { key: 'low_stock_alert_email', value: ' ops@example.com ' },
]), { pct: 40, planMinMonthlySales: 300, planAvgMonths: 2, alertEmail: 'ops@example.com' })
assert.equal(parseLowStockSettings([{ key: 'restock_plan_avg_months', value: '4' }]).planAvgMonths, 3, 'invalid months fall back')
assert.equal(parseLowStockSettings([{ key: 'low_stock_pct', value: 'abc' }]).pct, 50, 'invalid pct falls back')

// ── Stocked level ─────────────────────────────────────────────────────────
const plain = { pairs_per_code: 3, on_stock_plan: false }
const planStore = { pairs_per_code: 3, on_stock_plan: true }
assert.equal(stockedLevel({ quantity_on_hand: 2, stocked_level: null, plan_level: null }, plain), 3, 'default = pairs per code')
assert.equal(stockedLevel({ quantity_on_hand: 2, stocked_level: 10, plan_level: null }, plain), 10, 'manual override wins')
assert.equal(stockedLevel({ quantity_on_hand: 2, stocked_level: 10, plan_level: 7 }, planStore), 7, 'plan store ignores override')
assert.equal(stockedLevel({ quantity_on_hand: 2, stocked_level: null, plan_level: null }, planStore), 0, 'plan store without a level')

// ── Threshold and code status ───────────────────────────────────────────
assert.equal(lowThreshold(3, 50), 1.5)
assert.equal(lowThreshold(1, 50), 1, 'never below 1 pair')
assert.equal(lowThreshold(0, 50), 1)
assert.equal(lowThreshold(10, 50), 5)
assert.equal(codeStatus(0, 10, 50), 'out_of_stock')
assert.equal(codeStatus(1, 3, 50), 'low_stock')   // 1 <= 1.5
assert.equal(codeStatus(2, 3, 50), 'in_stock')    // 2 > 1.5
assert.equal(codeStatus(1, 1, 50), 'low_stock')   // threshold floor of 1
assert.equal(codeStatus(2, 1, 50), 'in_stock')
assert.equal(codeStatus(5, 10, 50), 'low_stock')  // 5 <= 5
assert.equal(codeStatus(6, 10, 50), 'in_stock')
assert.equal(codeStatus(2, 10, 20), 'low_stock')  // 10 x 20% = 2
assert.equal(codeStatus(3, 10, 20), 'in_stock')   // 3 > 2
assert.deepEqual(describeCode({ quantity_on_hand: 1, stocked_level: null, plan_level: null }, plain, 50), {
  stocked: 3, threshold: 1.5, status: 'low_stock',
})

// ── Store total ─────────────────────────────────────────────────────────
// 4 codes at 3 each = 12 stocked; 50% = 6. 5 on hand → needs restock; 6 → not.
const codes = (qohs: number[]) => qohs.map((q) => ({ quantity_on_hand: q, stocked_level: null, plan_level: null }))
const low5 = storeStockSummary(codes([2, 1, 1, 1]), plain, 50)
assert.equal(low5.on_hand, 5)
assert.equal(low5.stocked, 12)
assert.equal(low5.needs_restock, true, '5 of 12 is below 50%')
assert.equal(low5.pct_of_stocked, 42)
assert.equal(low5.low_codes, 3)
assert.equal(low5.out_codes, 0)
assert.equal(formatStoreStock(low5), '5 of 12 pairs (42%)')

const ok6 = storeStockSummary(codes([2, 2, 1, 1]), plain, 50)
assert.equal(ok6.needs_restock, false, '6 of 12 is exactly 50%, not below')

const outStore = storeStockSummary(codes([0, 0]), plain, 50)
assert.equal(outStore.out_codes, 2)
assert.equal(outStore.needs_restock, true)

const empty = storeStockSummary([], plain, 50)
assert.equal(empty.needs_restock, false, 'nothing stocked means nothing to restock')
assert.equal(empty.pct_of_stocked, null)

// ── 4-month plan allocation ─────────────────────────────────────────────
// total 10 split 3:1 → 7.5 / 2.5 → floors 7 and 2, last pair to the tie
// broken by id (a) → a=8, b=2.
const split = allocateByShare(10, new Map([['a', 3], ['b', 1]]), ['a', 'b'])
assert.deepEqual([...split.entries()], [['a', 8], ['b', 2]])

// parts always add up to the total
const three = allocateByShare(157, new Map([['x', 5], ['y', 2], ['z', 9]]), ['x', 'y', 'z'])
assert.equal([...three.values()].reduce((a, b) => a + b, 0), 157)

// codes with no sales (no weight) get nothing when others have sales
const withZero = allocateByShare(20, new Map([['a', 4], ['b', 0]]), ['a', 'b'])
assert.equal(withZero.get('b'), 0)
assert.equal(withZero.get('a'), 20)

// no sales at all: equal split
const equal = allocateByShare(7, new Map(), ['a', 'b', 'c'])
assert.equal([...equal.values()].reduce((a, b) => a + b, 0), 7)
assert.ok(Math.max(...equal.values()) - Math.min(...equal.values()) <= 1)

assert.equal(allocateByShare(5, new Map(), []).size, 0)

console.log('low-stock: all assertions passed')
