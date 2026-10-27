// Unit test for the Restock Calculator (Wayne's method) maths.
// Run: npx tsx scripts/test-wayne-calc.ts
//
// Fixtures are the live sales and store_inventory rows of Hyperground
// (STR-015) and ONE NINE NINE STORE PLT (STR-019) as of 27 Oct 2026
// (sales summed per day per SKU). Expected values were worked out
// separately by hand/Python, not by running this code.
import assert from 'node:assert/strict'
import {
  calcStore, resolvePeriod, monthBlocks, subMonths, describePeriod, formatDateRange,
  parseWayneSettings, malaysiaToday, DEFAULT_WAYNE_SETTINGS,
  type CalcProduct, type CalcSale, type WayneInput,
} from '../lib/restock/wayne-calc'

type Row = [date: string, sku: string, qty: number, amount: number]
const S = DEFAULT_WAYNE_SETTINGS
const TODAY = '2026-10-27'

// Plain Series SKUs (A12, H26 …) sell at RM13.99, everything else at RM19.99
const product = (sku: string): CalcProduct => ({
  id: sku, sku, name: sku, selling_price: /^[AH]\d+$/.test(sku) ? 13.99 : 19.99,
})
const toSales = (rows: Row[]): CalcSale[] => rows.map(([sale_date, sku, quantity, total_amount]) => ({ product_id: sku, sale_date, quantity, total_amount }))
const productsFor = (rows: Row[], inv: Record<string, number>) =>
  Object.fromEntries([...new Set([...rows.map((r) => r[1]), ...Object.keys(inv)])].map((sku) => [sku, product(sku)]))
const toInventory = (inv: Record<string, number>) => Object.entries(inv).map(([product_id, quantity_on_hand]) => ({ product_id, quantity_on_hand }))

// ── Date helpers ────────────────────────────────────────────────────────
assert.equal(malaysiaToday(new Date('2026-10-31T17:00:00Z')), '2026-11-01') // MY is UTC+8
assert.equal(subMonths('2026-10-26', 3), '2026-07-26')
assert.equal(subMonths('2026-05-31', 3), '2026-02-28') // clamped
assert.equal(subMonths('2026-01-15', 2), '2025-11-15')
assert.deepEqual(monthBlocks('2026-10-26', 3), [
  { start: '2026-07-27', end: '2026-08-26' },
  { start: '2026-08-27', end: '2026-09-26' },
  { start: '2026-09-27', end: '2026-10-26' },
])
assert.deepEqual(monthBlocks('2026-03-30', 2), [ // consecutive across a short February
  { start: '2026-01-31', end: '2026-02-28' },
  { start: '2026-03-01', end: '2026-03-30' },
])
// last sale 26 Oct, 3 months → 27 Jul – 26 Oct
assert.equal(resolvePeriod('2026-07-15', '2026-10-26', 3).start, '2026-07-27')
assert.equal(resolvePeriod('2026-07-15', '2026-10-26', 2).start, '2026-08-27')
assert.equal(formatDateRange('2025-11-27', '2026-01-26'), '27 Nov 2025 – 26 Jan 2026')

// ── Hyperground (STR-015): full history, last sale 26 Oct ────────────────
const HG: Row[] = [
  ['2026-07-15','BLUEELEPHANT',1,19.99],['2026-07-15','BROWNMONKEY',1,19.99],['2026-07-15','GREENTAPIR',2,39.98],['2026-07-15','KHAKIDURIAN',1,19.99],['2026-07-15','MAROONHORNBILL',1,19.99],['2026-07-15','ORANGERHINO',2,39.98],['2026-07-15','SEAGREENTIGER',3,59.97],
  ['2026-07-23','BROWNMONKEY',1,19.99],['2026-07-23','KHAKIDURIAN',2,39.98],['2026-07-23','MAROONHORNBILL',2,39.98],['2026-07-23','SEAGREENTIGER',2,39.98],['2026-07-23','WHITEKUIH',1,19.99],
  ['2026-07-31','BLACKHIBISCUS',1,19.99],['2026-07-31','BLUEELEPHANT',1,19.99],['2026-07-31','KHAKIDURIAN',2,39.98],['2026-07-31','MAROONHORNBILL',2,39.98],['2026-07-31','ORANGERHINO',2,39.98],['2026-07-31','WHITEKUIH',3,59.97],
  ['2026-08-01','BLACKHIBISCUS',1,15.99],['2026-08-01','BLUEELEPHANT',1,15.99],['2026-08-01','KHAKIDURIAN',2,35.99],['2026-08-01','ORANGERHINO',1,15.99],['2026-08-01','PINKSLIPPER',1,15.99],
  ['2026-08-07','BLACKHIBISCUS',1,15.99],['2026-08-07','BROWNMONKEY',1,16.00],['2026-08-07','GREENTAPIR',1,15.99],['2026-08-07','MAROONHORNBILL',1,15.99],['2026-08-07','WHITEKUIH',1,15.99],
  ['2026-08-28','BLACKHIBISCUS',1,19.99],['2026-08-28','BLUEELEPHANT',2,39.98],['2026-08-28','BROWNMONKEY',1,19.99],['2026-08-28','GREENTAPIR',1,19.99],['2026-08-28','KHAKIDURIAN',1,19.99],['2026-08-28','MAROONHORNBILL',1,19.99],['2026-08-28','PINKSLIPPER',1,19.99],['2026-08-28','WHITEKUIH',1,19.99],
  ['2026-08-31','BROWNMONKEY',1,19.99],['2026-08-31','KHAKIDURIAN',1,19.99],['2026-08-31','MAROONHORNBILL',1,15.99],['2026-08-31','SEAGREENTIGER',3,55.98],['2026-08-31','WHITEKUIH',2,31.98],
  ['2026-09-04','BLACKHIBISCUS',1,19.99],['2026-09-04','BLUEELEPHANT',1,19.99],['2026-09-04','KHAKIDURIAN',1,19.99],['2026-09-04','MAROONHORNBILL',1,19.99],['2026-09-04','SEAGREENTIGER',1,19.99],['2026-09-04','WHITEKUIH',2,39.98],
  ['2026-09-09','BLUEELEPHANT',1,19.99],['2026-09-09','PINKSLIPPER',1,19.99],['2026-09-09','WHITEKUIH',2,39.98],
  ['2026-09-12','A21',1,13.99],['2026-09-12','A23',1,13.99],['2026-09-12','A26',1,13.99],['2026-09-12','BLUEELEPHANT',2,39.98],['2026-09-12','BROWNMONKEY',2,39.98],['2026-09-12','GREENTAPIR',1,19.99],['2026-09-12','ORANGERHINO',1,19.99],['2026-09-12','SEAGREENTIGER',1,19.99],['2026-09-12','WHITEKUIH',1,19.99],
  ['2026-09-15','A13',1,13.99],['2026-09-15','A26',2,27.98],['2026-09-15','A31',1,13.99],['2026-09-15','BLACKHIBISCUS',1,19.99],
  ['2026-09-27','A26',2,27.98],['2026-09-27','A31',1,13.99],['2026-09-27','GREENTAPIR',2,39.98],['2026-09-27','NEONORANGERHYNO',1,19.99],['2026-09-27','SEAGREENTIGER',2,39.98],
  ['2026-10-02','A23',1,13.99],['2026-10-02','A31',1,13.99],['2026-10-02','BLUEELEPHANT',1,19.99],['2026-10-02','GREENTAPIR',1,19.99],
  ['2026-10-12','A13',1,13.99],['2026-10-12','A21',2,27.98],['2026-10-12','A23',2,27.98],['2026-10-12','A26',1,13.99],['2026-10-12','A31',1,13.99],['2026-10-12','BLACKBEES',1,15.99],['2026-10-12','BLUEELEPHANT',1,18.17],['2026-10-12','BROWNMONKEY',3,50.16],['2026-10-12','GREENTAPIR',3,54.15],['2026-10-12','KHAKIFISH',1,16.00],['2026-10-12','MAROONHORNBILL',3,50.15],['2026-10-12','ORANGERHINO',3,54.52],['2026-10-12','PINKSLIPPER',2,34.17],['2026-10-12','SEAGREENTIGER',3,52.34],['2026-10-12','WHITEKUIH',1,18.17],
  ['2026-10-23','A21',1,13.99],['2026-10-23','BROWNMONKEY',2,39.98],['2026-10-23','WHITEKUIH',1,19.99],
  ['2026-10-26','A13',1,13.99],['2026-10-26','A21',1,13.99],['2026-10-26','A31',1,13.99],['2026-10-26','BLACKBEES',1,19.99],['2026-10-26','BLUEELEPHANT',1,19.99],['2026-10-26','BROWNMONKEY',1,19.99],['2026-10-26','WHITEKUIH',1,19.99],
]
const HG_INV = { A13: 3, A21: 1, A23: 2, A26: 0, A31: 1, BLACKBEES: 8, BLACKHIBISCUS: 4, BLUEELEPHANT: 8, BROWNMONKEY: 4, GREENTAPIR: 9, KHAKIDURIAN: 0, KHAKIFISH: 9, MAROONHORNBILL: 8, NEONORANGERHYNO: 9, ORANGERHINO: 1, PINKSLIPPER: 5, SEAGREENTIGER: 5, WHITEKUIH: 5 }
const hg: WayneInput = {
  today: TODAY, months: 3, settings: S,
  store: { id: 'hg', store_code: 'STR-015', store_name: 'HYPRGROUND HOLDING SDN BHD' },
  products: productsFor(HG, HG_INV), sales: toSales(HG),
  firstSaleDate: '2026-07-15', lastSaleDate: '2026-10-26', inventory: toInventory(HG_INV),
}

const h3 = calcStore(hg)
assert.equal(h3.period.start, '2026-07-27')
assert.equal(h3.period.end, '2026-10-26')
assert.equal(h3.period.short_history, false)
assert.equal(h3.period.months_covered, 3)
assert.equal(describePeriod(h3.period), '27 Jul – 26 Oct 2026 (3 months, ending on last recorded sale)')
// 117.7579 pairs ÷ 3 = 39.2526
assert.equal(h3.pairs_per_month, 39.3)
assert.equal(h3.target_stock, 157)
assert.equal(h3.restock_trigger, 79)
assert.equal(h3.on_hand, 82)
assert.equal(h3.status, 'stock_ok') // 82 ≥ 79
// blocks 27 Jul–26 Aug / 27 Aug–26 Sep / 27 Sep–26 Oct
assert.deepEqual(h3.months.map((b) => b.pairs), [21.04, 45.62, 51.1])
assert.deepEqual(h3.months.map((b) => b.start), ['2026-07-27', '2026-08-27', '2026-09-27'])
assert.equal(h3.months[0].flagged, true) // −46% vs 39.25
assert.equal(h3.consistency_flag, true)
assert.equal(h3.days_since_last_sale, 1)
assert.equal(h3.stale_sales, false)
assert.equal(h3.pairs_to_send, h3.skus.reduce((a, x) => a + x.send, 0))
assert.equal(h3.sold_not_in_inventory.length, 0)
// sales before 27 Jul (15 Jul, 23 Jul) are outside the period
assert.equal(h3.skus.find((x) => x.product_id === 'SEAGREENTIGER')?.pairs_sold, 3 + 1 + 1 + 2 + 3) // 31 Aug, 4 Sep, 12 Sep, 27 Sep, 12 Oct

const h2 = calcStore({ ...hg, months: 2 })
assert.equal(describePeriod(h2.period), '27 Aug – 26 Oct 2026 (2 months, ending on last recorded sale)')
assert.equal(h2.pairs_per_month, 48.4) // 96.7157 ÷ 2
assert.equal(h2.target_stock, 193)
assert.equal(h2.restock_trigger, 97)
assert.equal(h2.status, 'restock_now') // 82 < 97
assert.equal(h2.months.length, 2)

// ── ONE NINE NINE STORE PLT (STR-019): first sale 21 Aug, last 23 Oct ────
const O99: Row[] = [
  ['2026-08-21','A27',3,41.97],['2026-08-31','H32',1,13.99],['2026-08-31','H35',1,13.99],['2026-09-05','A26',1,13.99],
  ['2026-09-11','A12',1,13.99],['2026-09-11','A21',1,13.99],['2026-09-11','A27',1,13.99],['2026-09-11','A35',1,13.99],['2026-09-11','H26',1,13.99],
  ['2026-09-15','A35',1,13.99],['2026-09-15','H26',1,13.99],['2026-09-18','A26',1,13.99],['2026-09-19','A21',1,13.99],['2026-09-19','A26',1,13.99],['2026-09-19','A29',1,13.99],
  ['2026-09-22','H26',2,27.98],['2026-09-22','H27',1,13.99],['2026-09-24','A27',2,27.98],['2026-09-26','A26',1,13.99],['2026-09-30','A26',2,27.98],['2026-09-30','A27',2,27.98],
  ['2026-10-03','A26',1,13.99],['2026-10-03','A27',1,13.99],['2026-10-04','A29',1,13.99],['2026-10-10','A19',1,13.99],['2026-10-14','A27',2,27.98],['2026-10-14','H51',1,13.99],
  ['2026-10-16','A35',1,13.99],['2026-10-16','H32',1,13.99],['2026-10-17','A26',1,13.99],['2026-10-17','A27',1,13.99],['2026-10-17','H51',1,13.99],['2026-10-23','H22',1,13.99],
]
const O99_INV = { A12: 3, A13: 4, A19: 2, A21: 2, A26: 9, A27: 10, A29: 2, A32: 4, A35: 1, A42: 4, A46: 4, A6: 3, H12: 4, H13: 4, H19: 3, H21: 4, H22: 2, H26: 10, H27: 13, H29: 4, H32: 2, H35: 6, H46: 4, H51: 2, H6: 3 }
const o99: WayneInput = {
  today: TODAY, months: 3, settings: S,
  store: { id: 'o99', store_code: 'STR-019', store_name: 'ONE NINE NINE STORE PLT' },
  products: productsFor(O99, O99_INV), sales: toSales(O99),
  firstSaleDate: '2026-08-21', lastSaleDate: '2026-10-23', inventory: toInventory(O99_INV),
}

// 3 months would start 24 Jul, but the first sale is 21 Aug → short history.
// Previously "Not enough history"; now it calculates with a warning.
const o3 = calcStore(o99)
assert.notEqual(o3.status, 'not_enough_history')
assert.equal(o3.period.nominal_start, '2026-07-24')
assert.equal(o3.period.start, '2026-08-21')
assert.equal(o3.period.short_history, true)
assert.equal(o3.period.months_covered, 2.07) // 63 days ÷ 30.4 = 2.072
assert.equal(describePeriod(o3.period), '21 Aug – 23 Oct 2026 (2.1 months of history, ending on last recorded sale)')
assert.equal(o3.pairs_per_month, 20.8) // 559.60 ÷ 13 = 43.046 pairs ÷ 2.072
assert.equal(o3.target_stock, 83)
assert.equal(o3.restock_trigger, 42)
assert.equal(o3.on_hand, 109)
assert.equal(o3.status, 'stock_ok')
// first block (24 Jul – 23 Aug) starts before the first sale → partial, not checked
assert.deepEqual(o3.months.map((b) => b.pairs), [3.23, 18.29, 21.52])
assert.deepEqual(o3.months.map((b) => b.partial), [true, false, false])
assert.equal(o3.months[0].deviation_pct, null)
assert.equal(o3.consistency_flag, false) // −12% / +4%
assert.equal(o3.days_since_last_sale, 4)
// 2 months starts 24 Aug, before which the store already had sales → full period
const o2 = calcStore({ ...o99, months: 2 })
assert.equal(o2.period.short_history, false)
assert.equal(o2.period.start, '2026-08-24')
assert.equal(o2.period.months_covered, 2)

// ── Under 1 month of sales → no calculation ─────────────────────────────
const tiny = calcStore({ ...o99, firstSaleDate: '2026-09-24' }) // 29 days
assert.equal(tiny.status, 'not_enough_history')
assert.equal(tiny.target_stock, null)
assert.equal(tiny.skus.length, 0)
const oneMonth = calcStore({ ...o99, firstSaleDate: '2026-09-22', sales: toSales(O99.filter((r) => r[0] >= '2026-09-22')) }) // 31 days
assert.equal(oneMonth.status === 'not_enough_history', false)
assert.equal(oneMonth.period.months_covered, 1.02)
assert.equal(calcStore({ ...o99, firstSaleDate: null, lastSaleDate: null }).status, 'not_enough_history')

// ── Restock now, per-SKU maths, sold-not-in-inventory ──────────────────
const low = calcStore({ ...hg, inventory: [{ product_id: 'WHITEKUIH', quantity_on_hand: 2 }] })
assert.equal(low.status, 'restock_now')
assert.equal(low.skus.length, 1)
assert.equal(low.skus[0].share, 1)
assert.equal(low.skus[0].sku_target, 157)
assert.equal(low.skus[0].send, 155)
assert.ok(low.sold_not_in_inventory.some((x) => x.product_id === 'BLUEELEPHANT'))

// ── Stale sales warning (last sale more than 7 days ago) ───────────────
assert.equal(calcStore({ ...hg, today: '2026-11-02' }).stale_sales, false) // 7 days
assert.equal(calcStore({ ...hg, today: '2026-11-03' }).stale_sales, true) // 8 days

// ── Editable settings come from public.settings ────────────────────────
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
assert.equal(r2.target_stock, Math.round(39.2526 * 3))
assert.equal(r2.restock_trigger, Math.round(39.2526 * 1.5))

console.log('wayne-calc: all assertions passed')
console.log(`Hyperground (3 mo): ${describePeriod(h3.period)} → ${h3.pairs_per_month} pairs/month, target ${h3.target_stock}, trigger ${h3.restock_trigger}, on hand ${h3.on_hand}, ${h3.status}`)
console.log(`ONE NINE NINE (3 mo): ${describePeriod(o3.period)} → ${o3.pairs_per_month} pairs/month, target ${o3.target_stock}, trigger ${o3.restock_trigger}, on hand ${o3.on_hand}, ${o3.status}`)
