// Unit test for colour distance and similar-colour suggestions.
// Run: npx tsx scripts/test-colour-suggestions.ts
import assert from 'node:assert/strict'
import { deltaE00, hexToLab, suggestSimilar, suggestionLabel } from '../lib/stock/colour-suggestions'
import { parsePlainCode, yarnColourByNo, CATALOGUE_YARN_NOS } from '../lib/stock/yarn-colours'

// ── CIEDE2000 against published reference pairs (Sharma 2005, test data) ──
const close = (x: number, y: number, tol = 1e-3) => assert.ok(Math.abs(x - y) < tol, `${x} ≈ ${y}`)
close(deltaE00({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }), 2.0425)
close(deltaE00({ L: 50, a: 0, b: 0 }, { L: 50, a: 0, b: 0 }), 0)
close(deltaE00({ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }), 27.1492, 1e-2)

// ── Hex → Lab sanity ──────────────────────────────────────────────────────
close(hexToLab('#ffffff').L, 100, 0.01)
close(hexToLab('#000000').L, 0, 0.01)

// ── Plain Series code parsing ─────────────────────────────────────────────
assert.deepEqual(parsePlainCode('A19'), { letter: 'A', no: 19 })
assert.deepEqual(parsePlainCode(' h9 '), { letter: 'H', no: 9 })
assert.deepEqual(parsePlainCode('C9'), { letter: 'C', no: 9 })
assert.equal(parsePlainCode('P12'), null, 'other series is not plain')
assert.equal(parsePlainCode('A19X'), null)
assert.equal(parsePlainCode('19'), null)
assert.equal(parsePlainCode(null), null)

// ── Colour table ──────────────────────────────────────────────────────────
assert.equal(yarnColourByNo(27)?.name, 'Classic Black')
assert.equal(yarnColourByNo(18)?.name, 'Grey Black')
assert.equal(yarnColourByNo(57), undefined)
assert.ok(CATALOGUE_YARN_NOS.has(27) && CATALOGUE_YARN_NOS.has(18) && !CATALOGUE_YARN_NOS.has(1))

// ── Suggestions ───────────────────────────────────────────────────────────
const hq = new Map<string, number | null>([
  ['A27', 0],     // the short one itself
  ['A18', 12],    // Grey Black: catalogue, same letter, stocked
  ['A38', 7],     // Classic Blue: catalogue, stocked
  ['A26', 9],     // Clean White: catalogue, stocked
  ['A1', 50],     // not catalogue
  ['H18', 50],    // other cut letter
  ['A30', 2],     // below the 3-pair minimum
  ['A12', null],  // never synced
])

const s1 = suggestSimilar('A27', 5, hq)
assert.equal(s1.length, 2, 'two suggestions')
assert.equal(s1[0].sku, 'A18', 'Grey Black is the closest stocked catalogue colour to Classic Black')
assert.equal(suggestionLabel(s1[0]), 'A18 Grey Black')
assert.ok(s1.every((s) => s.enoughStock), 'both cover 5 pairs')
for (const bad of ['A1', 'H18', 'A30', 'A12', 'A27']) assert.ok(!s1.some((s) => s.sku === bad), `${bad} excluded`)

// Already in this restock/DO → skipped
const s2 = suggestSimilar('A27', 5, hq, new Set(['A18']))
assert.ok(!s2.some((s) => s.sku === 'A18'), 'excluded colour is skipped')
assert.equal(s2.length, 2)

// Enough stock is preferred over a closer colour that cannot cover the need
const hq2 = new Map<string, number | null>([['A27', 0], ['A18', 4], ['A38', 40]])
const s3 = suggestSimilar('A27', 10, hq2)
assert.equal(s3[0].sku, 'A38', 'covering colour first even if farther')
assert.equal(s3[1].sku, 'A18', 'the short-stock colour still comes back as second')
assert.equal(s3[1].enoughStock, false)

// No stock anywhere but still returns the closest
const hq3 = new Map<string, number | null>([['A27', 0], ['A18', 1], ['A38', 2]])
const s4 = suggestSimilar('A27', 5, hq3)
assert.ok(s4.length === 0, 'below the 3-pair minimum nothing is suggested')

// Non-plain SKUs get nothing
assert.deepEqual(suggestSimilar('P27', 5, hq), [])
assert.deepEqual(suggestSimilar('A1X', 5, hq), [])

console.log('test-colour-suggestions: all checks passed')
