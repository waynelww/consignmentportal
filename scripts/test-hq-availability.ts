// Unit test for the Office (HQ) availability rule.
// Run: npx tsx scripts/test-hq-availability.ts
import assert from 'node:assert/strict'
import { hqAvailability, hqAvailabilityForSku, normalizeSku } from '../lib/stock/hq-availability'

assert.equal(hqAvailability(0, 5), 'out', 'HQ 0 is out')
assert.equal(hqAvailability(0, 0), 'out', 'HQ 0 is out even with nothing needed')
assert.equal(hqAvailability(3, 5), 'short', 'HQ below needed is short')
assert.equal(hqAvailability(5, 5), 'ok', 'HQ equal to needed is ok')
assert.equal(hqAvailability(9, 5), 'ok', 'HQ above needed is ok')
assert.equal(hqAvailability(null, 5), 'ok', 'never synced gives no warning')
assert.equal(hqAvailability(undefined, 5), 'ok', 'missing gives no warning')

assert.equal(normalizeSku('  ab-12 '), 'AB-12')
assert.equal(normalizeSku(null), '')

const map = new Map<string, number | null>([['AB-12', 0], ['CD-34', 2], ['EF-56', null]])
assert.deepEqual(hqAvailabilityForSku(' ab-12', 1, map), { status: 'out', hqQty: 0 })
assert.deepEqual(hqAvailabilityForSku('cd-34', 6, map), { status: 'short', hqQty: 2 })
assert.deepEqual(hqAvailabilityForSku('EF-56', 6, map), { status: 'ok', hqQty: null })
assert.deepEqual(hqAvailabilityForSku('ZZ-99', 6, map), { status: 'ok', hqQty: null }, 'unknown SKU gives no warning')
assert.deepEqual(hqAvailabilityForSku('', 6, map), { status: 'ok', hqQty: null })

console.log('test-hq-availability: all checks passed')
