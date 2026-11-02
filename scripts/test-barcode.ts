// Unit test for barcode normalisation and matching (lib/barcode/normalize.ts).
// Run: npx tsx scripts/test-barcode.ts
import assert from 'node:assert/strict'
import { normalizeBarcode, barcodesMatch, findByBarcode } from '../lib/barcode/normalize'

// UPC-A and EAN-13 with a leading zero are the same code
assert.equal(normalizeBarcode('726529949100'), '726529949100')
assert.equal(normalizeBarcode('0726529949100'), '726529949100')
assert.ok(barcodesMatch('726529949100', '0726529949100'), 'UPC-A matches EAN-13 with leading 0')
assert.ok(barcodesMatch('0726529949100', '726529949100'), 'matching is symmetric')

// Different codes stay different
assert.equal(barcodesMatch('726529949100', '0726529950397'), false, 'different products do not match')

// A real EAN-13 (leading digit not 0) is left as 13 digits
assert.equal(normalizeBarcode('8901234567890'), '8901234567890')
assert.equal(barcodesMatch('8901234567890', '901234567890'), false, 'only a leading 0 is dropped')

// Whitespace is ignored; empty input is null
assert.equal(normalizeBarcode(' 0726 529949100 '), '726529949100')
assert.equal(normalizeBarcode(''), null)
assert.equal(normalizeBarcode('   '), null)
assert.equal(normalizeBarcode(null), null)
assert.equal(normalizeBarcode(undefined), null)
assert.equal(barcodesMatch(null, '726529949100'), false, 'a missing barcode never matches')
assert.equal(barcodesMatch(null, null), false, 'two missing barcodes never match')

// Code 128 can hold letters: trimmed and upper-cased, otherwise unchanged
assert.equal(normalizeBarcode(' xk-12a '), 'XK-12A')
assert.ok(barcodesMatch('xk-12a', 'XK-12A'))

// Short numeric codes are not padded or changed
assert.equal(normalizeBarcode('00012345'), '00012345', 'only 13-digit codes lose a leading 0')

// findByBarcode returns the stored product for a scan in either form
const products = [
  { id: 'a', barcode: '726529949100' },
  { id: 'b', barcode: '0726529950397' },
  { id: 'c', barcode: null },
]
assert.equal(findByBarcode(products, '0726529949100')?.id, 'a', 'scan with leading 0 finds UPC-A row')
assert.equal(findByBarcode(products, '726529950397')?.id, 'b', 'scan without leading 0 finds EAN-13 row')
assert.equal(findByBarcode(products, '999999999999'), undefined, 'unknown code is not found')
assert.equal(findByBarcode(products, ''), undefined, 'empty scan finds nothing')

console.log('test-barcode: all assertions passed')
