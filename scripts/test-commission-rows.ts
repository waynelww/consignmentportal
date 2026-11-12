// Pins fitCommissionRows (lib/pdf/commission-rows.ts): the invoice's COMMISSION
// rows must add up exactly to the period total, with each row within 1 sen of
// its unrounded value. Run: npx tsx scripts/test-commission-rows.ts
import assert from 'node:assert/strict'
import { fitCommissionRows } from '../lib/pdf/commission-rows'

const sen = (v: number) => Math.round(v * 100)
const sumSen = (rows: Array<{ commission: number }>) => rows.reduce((s, r) => s + sen(r.commission), 0)

// XCSM-119 shape: rows add to 235.71 when rounded, total is 235.67.
{
  const raw = [78.5667, 78.5667, 78.5667]
  const out = fitCommissionRows(raw.map((commission) => ({ commission })), 235.67)
  assert.equal(sumSen(out), 23567)
  // Each row stays within one sen of its rounded-down value.
  out.forEach((r, i) => assert.ok(Math.abs(sen(r.commission) - Math.floor(raw[i] * 100 + 1e-9)) <= 1, 'row within 1 sen'))
}

// Rows short of the total: the extra sen go to the largest remainders first.
{
  const out = fitCommissionRows([{ commission: 10.001 }, { commission: 10.001 }], 20.01)
  assert.deepEqual(out.map((r) => r.commission), [10.01, 10.0])
}

// Rows already exact: nothing moves.
{
  const rows = [{ commission: 12.5, sku: 'A' }, { commission: 7.25, sku: 'B' }]
  const out = fitCommissionRows(rows, 19.75)
  assert.deepEqual(out, rows)
}

// Empty period.
assert.deepEqual(fitCommissionRows([], 0), [])

// Other fields are kept; the input array is not mutated.
{
  const rows = [{ commission: 1.005, productName: 'X' }, { commission: 1.005, productName: 'Y' }]
  const out = fitCommissionRows(rows, 2.01)
  assert.equal(out[0].productName, 'X')
  assert.equal(out[1].productName, 'Y')
  assert.equal(rows[0].commission, 1.005)
  assert.equal(sumSen(out), 201)
}

// Larger batch: total always matches to the sen.
{
  const rows = Array.from({ length: 37 }, (_, i) => ({ commission: (i * 7.31 + 0.0333) }))
  const total = rows.reduce((s, r) => s + r.commission, 0)
  const target = Math.round(total * 100) / 100
  const out = fitCommissionRows(rows, target)
  assert.equal(sumSen(out), Math.round(target * 100))
}

console.log('commission rows: all checks passed')
