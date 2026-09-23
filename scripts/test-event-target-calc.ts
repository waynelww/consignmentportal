// Unit test for the Event Target Calculator maths.
// Run: npx tsx scripts/test-event-target-calc.ts
import assert from 'node:assert/strict'
import { calcTargets, defaultWeights, DEFAULT_SETTINGS } from '../lib/events/target-calc'

// Spec-pinned expected values: medium level, 3 days Fri/Sat/Sun,
// crew 4/5/5, weights 25/40/35, round to 10.
const r = calcTargets({
  level: 'medium',
  rental: 0, delivery: 280, other_fixed: 300, pt_daily_rate: 120,
  days: [
    { label: 'Fri', crew: 4, weight_pct: 25 },
    { label: 'Sat', crew: 5, weight_pct: 40 },
    { label: 'Sun', crew: 5, weight_pct: 35 },
  ],
}, DEFAULT_SETTINGS)

assert.equal(r.pt_days, 14)
assert.equal(r.tier2_total, 800 * 14)               // 11,200
assert.equal(r.tier1_total, Math.round(11200 * 0.7)) // 7,840
assert.equal(r.tier3_total, Math.round(11200 * 1.5)) // 16,800
assert.equal(r.days[0].per_person_tier2, 700)        // 11,200 × .25 ÷ 4
assert.equal(r.days[1].per_person_tier2, 900)        // 11,200 × .40 ÷ 5
assert.equal(r.days[2].per_person_tier2, 780)        // 11,200 × .35 ÷ 5 = 784 → 780
assert.equal(r.fixed_cost, 280 + 300 + 14 * 120)     // 2,260
assert.equal(r.cover_ratio, Number((11200 / 2260).toFixed(2)))
assert.equal(r.days[1].customers_for_tier2, Math.ceil(900 / 50)) // 18

// zero-crew day contributes weight but no per-person number
const rz = calcTargets({
  level: 'small', rental: 0, delivery: 0, other_fixed: 0, pt_daily_rate: 0,
  days: [{ label: 'A', crew: 0, weight_pct: 50 }, { label: 'B', crew: 2, weight_pct: 50 }],
}, DEFAULT_SETTINGS)
assert.equal(rz.pt_days, 2)
assert.equal(rz.days[0].per_person_tier2, 0)
assert.equal(rz.days[1].per_person_tier2, Math.round(1000 * 0.5 / 2 / 10) * 10) // 250

// default weights
assert.deepEqual(defaultWeights(3), [25, 40, 35])
assert.deepEqual(defaultWeights(2), [55, 45])
assert.deepEqual(defaultWeights(4), [25, 25, 25, 25])

// per-head override wins over the level
const ro = calcTargets({
  level: 'medium', per_head_override: 1000,
  rental: 0, delivery: 0, other_fixed: 0, pt_daily_rate: 0,
  days: [{ label: 'A', crew: 2, weight_pct: 100 }],
}, DEFAULT_SETTINGS)
assert.equal(ro.tier2_total, 2000)

console.log('✓ all event target calc tests passed')
