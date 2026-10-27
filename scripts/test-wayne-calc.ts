// Unit test for the Restock Calculator (Wayne's method) maths.
// Run: npx tsx scripts/test-wayne-calc.ts
import assert from 'node:assert/strict'
import {
  calcStore, defaultEndMonth, periodFor, parseWayneSettings, malaysiaToday,
  DEFAULT_WAYNE_SETTINGS, type CalcProduct, type WayneInput,
} from '../lib/restock/wayne-calc'

const S = DEFAULT_WAYNE_SETTINGS
const products: Record<string, CalcProduct> = {
  sp1: { id: 'sp1', sku: 'SP-1', name: 'Special Patches Series - White Kuih', selling_price: 19.99 },
  sp2: { id: 'sp2', sku: 'SP-2', name: 'Special Patches Series - Blue Elephant', selling_price: 19.99 },
  pl1: { id: 'pl1', sku: 'PL-1', name: 'Plain Series - Ankle - Clean White', selling_price: 13.99 },
  old: { id: 'old', sku: 'OLD', name: 'Raya Socks 2026', selling_price: 19.99 },
}
const store = { id: 'hg', store_code: 'STR-015', store_name: 'HYPRGROUND HOLDING SDN BHD' }

// Period selection: on 27 Oct the default is Jul–Sep (Malaysia time)
assert.equal(defaultEndMonth('2026-10-27'), '2026-09')
assert.deepEqual(periodFor('2026-09').months, ['2026-07', '2026-08', '2026-09'])
assert.equal(periodFor('2026-09').end, '2026-09-30')
assert.deepEqual(periodFor('2026-01').months, ['2025-11', '2025-12', '2026-01'])
assert.equal(periodFor('2028-02').end, '2028-02-29')
// 31 Oct 17:00 UTC is already 1 Nov in Malaysia
assert.equal(malaysiaToday(new Date('2026-10-31T17:00:00Z')), '2026-11-01')

// Hyperground (STR-015), Jul–Sep 2026 — monthly totals from live data:
// Jul RM599.70 special; Aug RM503.75 special; Sep RM499.75 special + RM139.90 plain
const hg: WayneInput = {
  today: '2026-10-27',
  endMonth: '2026-09',
  settings: S,
  store,
  products,
  firstSaleDate: '2026-07-15',
  lastSaleDate: '2026-10-26',
  sales: [
    { product_id: 'sp1', sale_date: '2026-07-15', quantity: 20, total_amount: 399.80 },
    { product_id: 'sp2', sale_date: '2026-07-20', quantity: 10, total_amount: 199.90 },
    { product_id: 'sp1', sale_date: '2026-08-01', quantity: 18, total_amount: 323.80 },
    { product_id: 'sp2', sale_date: '2026-08-15', quantity: 10, total_amount: 179.95 },
    { product_id: 'sp1', sale_date: '2026-09-04', quantity: 15, total_amount: 299.85 },
    { product_id: 'sp2', sale_date: '2026-09-10', quantity: 10, total_amount: 199.90 },
    { product_id: 'pl1', sale_date: '2026-09-12', quantity: 10, total_amount: 139.90 },
    { product_id: 'old', sale_date: '2026-09-13', quantity: 0, total_amount: 0 },
    { product_id: 'sp1', sale_date: '2026-10-02', quantity: 43, total_amount: 725.60 }, // outside period
  ],
  inventory: [
    { product_id: 'sp1', quantity_on_hand: 40 },
    { product_id: 'sp2', quantity_on_hand: 30 },
    { product_id: 'pl1', quantity_on_hand: 12 },
  ],
}
const r = calcStore(hg)
assert.equal(r.status, 'stock_ok') // 82 on hand ≥ trigger 63
assert.equal(r.pairs_per_month, 31.7)
assert.equal(r.target_stock, 127)
assert.equal(r.restock_trigger, 63)
assert.equal(r.on_hand, 82)
assert.deepEqual(r.months.map((m) => m.sales_amount), [599.70, 503.75, 639.65])
assert.equal(r.months[0].pairs, Math.round((599.70 / 19) * 100) / 100)
assert.equal(r.months[2].pairs, Math.round((499.75 / 19 + 139.90 / 13) * 100) / 100)
// Aug 26.5 vs avg 31.7 → −16.4%, Sep 37.1 → +16.9%: within 20%
assert.equal(r.consistency_flag, false)
assert.equal(r.stale_sales, false)
assert.equal(r.days_since_last_sale, 1)

// Per SKU: shares of 93 pairs sold (sp1 53, sp2 30, pl1 10 — only inventory SKUs)
const bySku = Object.fromEntries(r.skus.map((x) => [x.product_id, x]))
const target = 31.7101 * 4 // exact avg × 4 ≈ 126.84
assert.equal(r.skus.reduce((a, x) => a + x.pairs_sold, 0), 93)
assert.equal(bySku.sp1.sku_target, Math.round((126.84 * 53) / 93))
assert.equal(bySku.sp1.send, Math.max(0, bySku.sp1.sku_target - 40))
assert.equal(bySku.pl1.sku_target, Math.round((126.84 * 10) / 93))
assert.equal(bySku.pl1.send, 2) // 14 − 12
assert.equal(r.pairs_to_send, r.skus.reduce((a, x) => a + x.send, 0))
assert.ok(Math.abs(target - 126.84) < 0.01)
// Raya sold in period but not in inventory → info only (0 pairs here → excluded)
assert.equal(r.sold_not_in_inventory.length, 0)

// Restock now when on hand < trigger; sold-not-in-inventory shows up
const low = calcStore({
  ...hg,
  inventory: [{ product_id: 'sp1', quantity_on_hand: 10 }],
  sales: [...hg.sales, { product_id: 'old', sale_date: '2026-08-20', quantity: 3, total_amount: 59.97 }],
})
assert.equal(low.status, 'restock_now')
assert.equal(low.skus.length, 1)
assert.equal(low.skus[0].share, 1)
assert.equal(low.skus[0].sku_target, low.target_stock)
assert.equal(low.skus[0].send, (low.target_stock ?? 0) - 10)
assert.deepEqual(low.sold_not_in_inventory.map((x) => x.product_id).sort(), ['pl1', 'sp2', 'old'].sort())

// Month-level history: first sale in Aug (2nd month) → not enough history
const fresh = calcStore({ ...hg, firstSaleDate: '2026-08-01' })
assert.equal(fresh.status, 'not_enough_history')
assert.equal(fresh.target_stock, null)
assert.equal(fresh.skus.length, 0)
assert.equal(calcStore({ ...hg, firstSaleDate: null, lastSaleDate: null }).status, 'not_enough_history')
// First sale on the last day of the first month still counts
assert.equal(calcStore({ ...hg, firstSaleDate: '2026-07-31' }).status, 'stock_ok')

// Consistency: a month more than 20% from the average is flagged
const spiky = calcStore({
  ...hg,
  sales: [
    { product_id: 'pl1', sale_date: '2026-07-10', quantity: 10, total_amount: 130 }, // 10 pairs
    { product_id: 'pl1', sale_date: '2026-08-10', quantity: 10, total_amount: 130 }, // 10
    { product_id: 'pl1', sale_date: '2026-09-10', quantity: 20, total_amount: 260 }, // 20 → avg 13.33
  ],
})
assert.equal(spiky.pairs_per_month, 13.3)
assert.equal(spiky.consistency_flag, true)
assert.equal(spiky.months[2].flagged, true) // +50%
assert.equal(spiky.months[0].flagged, true) // −25%

// Stale sales warning: last sale more than 7 days ago
assert.equal(calcStore({ ...hg, lastSaleDate: '2026-10-19' }).stale_sales, true) // 8 days
assert.equal(calcStore({ ...hg, lastSaleDate: '2026-10-20' }).stale_sales, false) // 7 days

// Editable settings: multipliers and prices come from the settings table
const s2 = parseWayneSettings([
  { key: 'restock_calc_target_multiplier', value: '3' },
  { key: 'restock_calc_trigger_multiplier', value: '1.5' },
  { key: 'restock_calc_price_plain', value: '0' }, // invalid → default
  { key: 'unrelated', value: 'x' },
])
assert.equal(s2.target_multiplier, 3)
assert.equal(s2.trigger_multiplier, 1.5)
assert.equal(s2.price_plain, 13)
const r2 = calcStore({ ...hg, settings: s2 })
assert.equal(r2.target_stock, Math.round(31.7101 * 3))
assert.equal(r2.restock_trigger, Math.round(31.7101 * 1.5))

console.log('wayne-calc: all assertions passed')
console.log(`Hyperground Jul–Sep 2026: ${r.pairs_per_month} pairs/month, target ${r.target_stock}, trigger ${r.restock_trigger}, on hand ${r.on_hand}, status ${r.status}`)
