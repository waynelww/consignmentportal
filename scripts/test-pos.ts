// npx tsx scripts/test-pos.ts — pins the Event POS discount and bonus rules.
import assert from 'node:assert/strict'
import { evaluateDiscount, cartTotals, type DiscountLine, type DiscountType } from '../lib/pos/discounts'
import { eligibleAmounts, tierHit, tiersForDay, nextTier } from '../lib/pos/bonus'
import { isAddon, isExcludedFromPos, isPatch, buildPosProducts, remainingFor, chipMatches, POS_CHIPS } from '../lib/pos/catalog'
import { summarisePatches } from '../lib/pos/patches'

const plain = (qty: number): DiscountLine => ({ unit_price: 13.99, qty, is_pair: true, is_patch: false, design: false })
const d = (type: DiscountType, params: Record<string, unknown>) => ({ type, params })
const off = (type: DiscountType, params: Record<string, unknown>, lines: DiscountLine[]) => evaluateDiscount(d(type, params), lines).amount

// The brief's check: 5 plain pairs at RM13.99.
const five = [plain(5)]
assert.equal(off('free_cheapest', { min_pairs: 5, free: 1 }, five), 13.99)
assert.equal(off('free_then_percent', { min_pairs: 5, free: 1, pct: 5 }, five), 16.79)
assert.equal(off('free_then_percent', { min_pairs: 5, free: 1, pct: 8 }, five), 18.47)
assert.equal(off('free_then_percent', { min_pairs: 5, free: 1, pct: 10 }, five), 19.59)
assert.equal(off('bundle_price', { pairs: 1, price: 5.99 }, five), 8.0)
assert.equal(off('per_pair_off', { amount: 2, unit_price: 13.99 }, five), 10.0)

// Not qualifying
const three = evaluateDiscount(d('free_cheapest', { min_pairs: 5, free: 1 }), [plain(3)])
assert.equal(three.qualifies, false)
assert.equal(three.note, 'Needs 5 pairs (3 in cart)')

// Cheapest pairs go free; add-ons never count as pairs
const mixed: DiscountLine[] = [
  plain(1),
  { unit_price: 19.99, qty: 1, is_pair: true, is_patch: false, design: true },
  { unit_price: 4, qty: 3, is_pair: false, is_patch: true, design: false },
]
assert.equal(off('free_cheapest', { min_pairs: 2, free: 1 }, mixed), 13.99)
assert.equal(evaluateDiscount(d('free_cheapest', { min_pairs: 3, free: 1 }), mixed).qualifies, false)
assert.equal(off('group_percent', { group: 'design', pct: 50 }, mixed), 10.0) // 19.99 × 50% = 9.995 → 10.00
assert.equal(off('addon_free', { patches: 2 }, mixed), 8)
assert.equal(off('bundle_price', { pairs: 2, price: 24.99 }, mixed), 8.99)
const t = cartTotals(mixed, d('percent', { pct: 10 }))
assert.equal(t.subtotal, 45.98); assert.equal(t.discount_amount, 4.6); assert.equal(t.total, 41.38); assert.equal(t.pairs, 2)

// Catalogue rules
assert.equal(isExcludedFromPos('Special Patches Series - White Kuih'), true)
assert.equal(isExcludedFromPos('Plain Series - Ankle - Black'), false)
assert.equal(isPatch('(RM4) Per Patches'), true)
assert.equal(isPatch('Patches Socks (LOKAL Jehhh) - Tiger'), false)
assert.equal(isPatch('Any Patch Socks'), false)
assert.equal(isAddon('(RM19.90) Xocks Tote Bag'), true)
const raw = (id: string, sku: string, name: string, price: number) => ({ id, sku, name, selling_price: price, image_url: null, barcode: null, category: 'ankle' })
const patchRaw = raw('p1', 'Patches', '(RM4) Per Patches', 4)
const tiles = buildPosProducts([
  { product: raw('p1', 'Patches', '(RM4) Per Patches', 4), qty: 20 }, // a patch stock row is ignored
  { product: raw('p2', 'A1', 'Plain Series - Ankle - Black', 13.99), qty: 3 },
  { product: raw('p3', 'WK', 'Special Patches Series - White Kuih', 19.99), qty: 9 },
  { product: raw('p4', '4FREEPATCHES', 'FREE 6 Patches', 0), qty: 5 },
], patchRaw)
assert.deepEqual(tiles.map((x) => x.id).sort(), ['free10patches', 'free6patches', 'p1', 'p2'])
// Patches: always there, no stock, never run out. Socks keep their event stock.
const free6 = tiles.find((x) => x.id === 'free6patches')!
assert.equal(free6.unlimited, true)
assert.equal(free6.stock_per_unit, 6)
assert.equal(remainingFor(free6, { p1: 300 }, tiles), Infinity)
assert.equal(remainingFor(tiles.find((x) => x.id === 'p1')!, { free10patches: 50 }, tiles), Infinity)
const sock = tiles.find((x) => x.id === 'p2')!
assert.equal(sock.unlimited, false)
assert.equal(remainingFor(sock, { p2: 2 }, tiles), 1)
// No event stock at all: patch tiles are still on the POS.
assert.deepEqual(buildPosProducts([], patchRaw).map((x) => x.id).sort(), ['free10patches', 'free6patches', 'p1'])
// No patch product passed: no patch tiles, even with a patch stock row.
assert.deepEqual(buildPosProducts([{ product: patchRaw, qty: 5 }]).map((x) => x.id), [])
// "Free 1 Set Patch" (2 RM4 patches) still works off the RM4 patch tile.
const patchTile = tiles.find((x) => x.id === 'p1')!
assert.equal(off('addon_free', { patches: 2 }, [{ unit_price: patchTile.price, qty: 2, is_pair: patchTile.is_pair, is_patch: patchTile.is_patch, design: false }]), 8)

// Patches given: RM4 lines = sold, FREE 6 / 10 = free (in patches); voided sales and socks ignored.
const line = (sku: string, qty: number, stock_qty: number, unit_price: number) => ({ sku, qty, stock_qty, unit_price })
assert.deepEqual(summarisePatches([
  { event_day: '2026-12-05', voided_at: null, pos_sale_items: [line('Patches', 3, 3, 4), line('Patches', 1, 10, 0)] },
  { event_day: '2026-12-04', voided_at: null, pos_sale_items: [line('PATCHES', 2, 2, 4), line('Patches', 2, 12, 0), line('A1', 1, 1, 13.99)] },
  { event_day: '2026-12-04', voided_at: '2026-12-04T10:00:00Z', pos_sale_items: [line('Patches', 9, 9, 4)] },
]), {
  days: [{ day: '2026-12-04', sold: 2, free: 12 }, { day: '2026-12-05', sold: 3, free: 10 }],
  sold: 5, free: 22,
})

// Bonus unlock: fixed cost 2,000 + unlock 1,000 → threshold 3,000.
assert.deepEqual(eligibleAmounts([1500, 1400, 300, 50], 2000, 1000), [0, 0, 200, 50])
assert.deepEqual(eligibleAmounts([5000], null, 1000), [0])
const days = [{ position: 0, label: 'Fri', per_person_tier1: 350, per_person_tier2: 500, per_person_tier3: 750 }]
const tiers = tiersForDay('2026-12-04', '2026-12-04', days)
const bonus = { bonus_tier1: 20, bonus_tier2: 50, bonus_tier3: 100 }
assert.deepEqual(tierHit(520, tiers, bonus), { tier: 2, bonus: 50 })
assert.deepEqual(tierHit(100, tiers, bonus), { tier: 0, bonus: 0 })
assert.deepEqual(nextTier(520, tiers), { tier: 3, more: 230 })
assert.equal(tiersForDay('2026-12-04', '2026-12-05', days), null)

// ── Kids (RM11.99) and No Show (RM13.99) ──────────────────────────────────
// Chips: Kids sits right after No Show.
const chipKeys = POS_CHIPS.map((c) => c.key)
assert.equal(chipKeys.indexOf('kids'), chipKeys.indexOf('no_show') + 1)
assert.equal(POS_CHIPS.find((c) => c.key === 'kids')?.label, 'Kids')
const vkTiles = buildPosProducts([
  { product: { id: 'k1', sku: 'K1', name: 'Plain Series - For Kids (4YO to 12 YO) - Aqua Blue', selling_price: 11.99, image_url: null, barcode: null, category: 'kids' }, qty: 4 },
  { product: { id: 'v27', sku: 'V27', name: 'Plain Series - No Show Socks - Classic Black', selling_price: 13.99, image_url: null, barcode: null, category: 'no_show' }, qty: 4 },
  { product: raw('a1', 'A1', 'Plain Series - Ankle - Black', 13.99), qty: 4 },
])
const kidsTile = vkTiles.find((x) => x.id === 'k1')!
const noShowTile = vkTiles.find((x) => x.id === 'v27')!
assert.equal(kidsTile.is_pair, true, 'Kids are pairs')
assert.equal(noShowTile.is_pair, true, 'No Show are pairs')
assert.ok(chipMatches(kidsTile, 'kids') && !chipMatches(kidsTile, 'no_show') && !chipMatches(kidsTile, 'ankle'))
assert.ok(chipMatches(noShowTile, 'no_show') && !chipMatches(noShowTile, 'kids'))
assert.deepEqual(vkTiles.filter((x) => chipMatches(x, 'kids')).map((x) => x.id), ['k1'])
// Discounts: Kids and No Show count as pairs.
const kids = (qty: number): DiscountLine => ({ unit_price: 11.99, qty, is_pair: true, is_patch: false, design: false })
assert.equal(off('free_cheapest', { min_pairs: 5, free: 1 }, [kids(2), plain(3)]), 11.99) // cheapest pair (Kids) free
assert.equal(evaluateDiscount(d('free_cheapest', { min_pairs: 5, free: 1 }), [kids(2), plain(3)]).qualifies, true)
assert.equal(cartTotals([kids(2), plain(1)], null).pairs, 3)
// "RM11.99 per pair" (RM2 off RM13.99 pairs) never touches RM11.99 Kids pairs.
assert.equal(off('per_pair_off', { amount: 2, unit_price: 13.99 }, [kids(3), plain(2)]), 4.0)
assert.equal(evaluateDiscount(d('per_pair_off', { amount: 2, unit_price: 13.99 }), [kids(3)]).qualifies, false)

console.log('test-pos: all passed')
