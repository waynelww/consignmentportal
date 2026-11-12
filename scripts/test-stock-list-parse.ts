// Unit test for the pasted restock-list parser (lib/stock-list/parse.ts).
// Run: npx tsx scripts/test-stock-list-parse.ts
import assert from 'node:assert/strict'
import { parseStockList, skuKey, type StockListProduct } from '../lib/stock-list/parse'

// Fixture catalogue (active unless noted). Names are colours; "Black" and
// "Teddy Brown" exist in several cuts, as in the real catalogue.
const CATALOG: StockListProduct[] = [
  { id: 'p-A6', sku: 'A6', name: 'Black', is_active: true },
  { id: 'p-A15', sku: 'A15', name: 'Black', is_active: true },
  { id: 'p-A21', sku: 'A21', name: 'Teddy Brown', is_active: true },
  { id: 'p-H21', sku: 'H21', name: 'Teddy Brown', is_active: true },
  { id: 'p-C21', sku: 'C21', name: 'Teddy Brown', is_active: true },
  { id: 'p-H5', sku: 'H5', name: 'Black', is_active: true },
  { id: 'p-A9', sku: 'A9', name: 'Grey', is_active: true },
  { id: 'p-C5', sku: 'C5', name: 'Grey', is_active: true },
  { id: 'p-MX5', sku: 'MX5', name: 'Mesh Black', is_active: true },
  { id: 'p-V12', sku: 'V12', name: 'No Show Red', is_active: true },
  { id: 'p-A50', sku: 'A50', name: 'Retired Colour', is_active: false },
  { id: 'p-WKU', sku: 'WHITEKUIHC26', name: 'White Kuih Patches', is_active: true },
]

let failures = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}`)
    console.log(`      ${e instanceof Error ? e.message : String(e)}`)
  }
}

// Compact view of a result: "A21x3" per item, sorted by appearance.
const view = (text: string) => {
  const r = parseStockList(text, CATALOG)
  return { items: r.items.map((i) => `${i.sku}x${i.quantity}`), noQuantity: r.noQuantity, notFound: r.notFound, unread: r.unread }
}

// ── Codes ───────────────────────────────────────────────────────────────────
test('code with x quantity', () => {
  assert.deepEqual(view('A21 x3').items, ['A21x3'])
})

test('quantity markers: x, ×, *, =, :, " - "', () => {
  for (const line of ['A21 x3', 'A21 ×3', 'A21 *3', 'A21 = 3', 'A21: 3', 'A21 - 3']) {
    assert.deepEqual(view(line).items, ['A21x3'], line)
  }
})

test('quantity words: pairs, pcs, pasang, psg, helai, units', () => {
  for (const line of ['A21 3 pairs', 'A21 3 pair', 'A21 3 pcs', 'A21 3 pasang', 'A21 3 psg', 'A21 3 helai', 'A21 3 units']) {
    assert.deepEqual(view(line).items, ['A21x3'], line)
  }
})

test('dash plus pairs word is one quantity, not two', () => {
  assert.deepEqual(view('A21 - 3 pairs').items, ['A21x3'])
  assert.deepEqual(view('A21 - 2 pairs / A6 = 4').items, ['A21x2', 'A6x4'])
})

test('single bare number on the line is the quantity', () => {
  assert.deepEqual(view('A21 3').items, ['A21x3'])
})

test('code spelling: a21, A 21, A-21, a021 are all A21', () => {
  for (const line of ['a21 x3', 'A 21 x3', 'A-21 x3', 'a021 x3']) {
    assert.deepEqual(view(line).items, ['A21x3'], line)
  }
  assert.equal(skuKey('a021'), 'A21')
})

test('MX code is matched', () => {
  assert.deepEqual(view('MX5 x2').items, ['MX5x2'])
})

test('code with no quantity = 0 and flagged', () => {
  const r = view('A21')
  assert.deepEqual(r.items, ['A21x0'])
  assert.deepEqual(r.noQuantity, ['A21'])
})

test('special patches SKU matched by exact SKU or product name', () => {
  assert.deepEqual(view('WHITEKUIHC26 x2').items, ['WHITEKUIHC26x2'])
  assert.deepEqual(view('white kuih patches x2').items, ['WHITEKUIHC26x2'])
})

test('unknown code is reported, not added', () => {
  const r = view('A99 x2')
  assert.deepEqual(r.items, [])
  assert.deepEqual(r.notFound, ['A99'])
})

test('inactive product is not matched', () => {
  const r = view('A50 x2')
  assert.deepEqual(r.items, [])
  assert.deepEqual(r.notFound, ['A50'])
})

test('No Show (V) code goes to unread, never added', () => {
  const r = view('V12 x2')
  assert.deepEqual(r.items, [])
  assert.ok(r.unread.some((u) => u.includes('No Show')), JSON.stringify(r.unread))
})

// ── Cut headers ─────────────────────────────────────────────────────────────
test('Ankle header applies to the lines below', () => {
  assert.deepEqual(view('Ankle\n06, 15, 21 x3').items, ['A6x3', 'A15x3', 'A21x3'])
})

test('inline cut list: last quantity applies to all numbers', () => {
  assert.deepEqual(view('Ankle 06, 15, 21 x3').items, ['A6x3', 'A15x3', 'A21x3'])
})

test('cut list separated by spaces', () => {
  assert.deepEqual(view('Ankle 06 15 21 x3').items, ['A6x3', 'A15x3', 'A21x3'])
})

test('Half and Crew headers', () => {
  assert.deepEqual(view('Half\n5 x2').items, ['H5x2'])
  assert.deepEqual(view('Crew\n21 x4').items, ['C21x4'])
})

test('cut list: quantity on a middle number does not spread', () => {
  const r = view('Ankle 06 x3, 15, 21')
  assert.deepEqual(r.items, ['A6x3', 'A15x0', 'A21x0'])
  assert.deepEqual(r.noQuantity, ['A15', 'A21'])
})

test('cut list: unknown number reported as not found', () => {
  const r = view('Ankle 06, 15, 21, 99 x3')
  assert.deepEqual(r.items, ['A6x3', 'A15x3', 'A21x3'])
  assert.deepEqual(r.notFound, ['A99'])
})

test('bare number with no cut goes to unread', () => {
  const r = view('21 x3')
  assert.deepEqual(r.items, [])
  assert.ok(r.unread.some((u) => u.includes('no Ankle, Half or Crew')), JSON.stringify(r.unread))
})

test('a cut header only lasts for lines below, and a new header replaces it', () => {
  assert.deepEqual(view('Ankle\n6 x1\nHalf\n5 x2').items, ['A6x1', 'H5x2'])
})

// ── Several items and merging ───────────────────────────────────────────────
test('several items on one line split by ; / and merge repeats', () => {
  assert.deepEqual(view('A21 x3; H5 x2 / A6 = 4 and A15 - 1').items, ['A21x3', 'H5x2', 'A6x4', 'A15x1'])
})

test('repeated SKU lines are summed', () => {
  const r = view('A21 x3\nA21 x2')
  assert.deepEqual(r.items, ['A21x5'])
})

// ── Colour names ────────────────────────────────────────────────────────────
test('colour in several cuts with no cut word: unread with possible SKUs', () => {
  const r = view('Teddy Brown 5')
  assert.deepEqual(r.items, [])
  assert.ok(r.unread.some((u) => u.includes('A21, H21, C21')), JSON.stringify(r.unread))
})

test('colour with an inline cut word matches that cut', () => {
  assert.deepEqual(view('Ankle Teddy Brown 5').items, ['A21x5'])
})

test('colour under a Half header matches the Half SKU', () => {
  assert.deepEqual(view('Half\nTeddy Brown 5').items, ['H21x5'])
})

test('colour under a cut it does not exist in is unread', () => {
  const r = view('Half\nGrey 2')
  assert.deepEqual(r.items, [])
  assert.ok(r.unread.some((u) => u.includes('no Half SKU')), JSON.stringify(r.unread))
})

test('colour name with a quantity and no cut word is unread when only one cut has it', () => {
  // Grey exists as A9 and C5, so this is ambiguous, not guessed.
  const r = view('Grey 4')
  assert.deepEqual(r.items, [])
  assert.ok(r.unread.some((u) => u.includes('A9') && u.includes('C5')), JSON.stringify(r.unread))
})

test('colour matched by name with quantity under a cut', () => {
  assert.deepEqual(view('Crew\nGrey 4').items, ['C5x4'])
})

// ── Lines that must not be read ─────────────────────────────────────────────
test('chatter and prices go to unread', () => {
  const r = view('Good morning bro\nRM 45')
  assert.deepEqual(r.items, [])
  assert.ok(r.unread.includes('Good morning bro'), JSON.stringify(r.unread))
  assert.ok(r.unread.includes('RM 45'), JSON.stringify(r.unread))
})

test('two quantities in one part are unread, not guessed', () => {
  const r = view('A21 x3 A6 x2')
  assert.deepEqual(r.items, [])
  assert.ok(r.unread.some((u) => u.includes('more than one quantity')), JSON.stringify(r.unread))
})

test('empty input gives an empty result', () => {
  assert.deepEqual(view('   \n\n'), { items: [], noQuantity: [], notFound: [], unread: [] })
})

console.log(failures === 0 ? '\nAll stock-list parse tests passed.' : `\n${failures} test(s) failed.`)
if (failures > 0) process.exit(1)
