// Tests for the onboarding pipeline rules (lib/onboarding/steps.ts).
// Run: npx tsx scripts/test-onboarding-rules.ts
import assert from 'node:assert/strict'
import {
  isRedCard, isOffBoard, nextStep, needsStoreLink, todayMYT, daysOnStep,
  compareOldestFirst, type OnboardingCardTiming,
} from '../lib/onboarding/steps'
import { shipmentLines } from '../lib/pdf/shipment'
import { buildPackingSlip, type SlipItem } from '../lib/pdf/generate-slip'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = new Date('2026-10-30T04:00:00Z') // 12:00 noon Malaysia, 30 Oct

function card(over: Partial<OnboardingCardTiming>): OnboardingCardTiming {
  return {
    step: 'agreement_made',
    step_changed_at: new Date(now.getTime() - HOUR).toISOString(),
    follow_up_date: null,
    first_sale_at: null,
    ...over,
  }
}

// ── Malaysia date ────────────────────────────────────────────────────────
// 23:30 UTC on 30 Oct is already 31 Oct in Malaysia.
assert.equal(todayMYT(new Date('2026-10-30T23:30:00Z')), '2026-10-31')
assert.equal(todayMYT(now), '2026-10-30')

// ── Steps ────────────────────────────────────────────────────────────────
assert.equal(nextStep('reached_out'), 'agreement_made')
assert.equal(nextStep('delivered'), 'first_sale')
assert.equal(nextStep('first_sale'), null)
assert.equal(needsStoreLink('details_received'), false)
assert.equal(needsStoreLink('account_created'), true)
assert.equal(needsStoreLink('first_sale'), true)

// ── Days on step ─────────────────────────────────────────────────────────
assert.equal(daysOnStep(new Date(now.getTime() - 3 * DAY - HOUR).toISOString(), now), 3)
assert.equal(daysOnStep(new Date(now.getTime() - 5 * HOUR).toISOString(), now), 0)

// ── Red: more than 24h on the same step ──────────────────────────────────
assert.equal(isRedCard(card({ step_changed_at: new Date(now.getTime() - 23 * HOUR).toISOString() }), now), false)
assert.equal(isRedCard(card({ step_changed_at: new Date(now.getTime() - 25 * HOUR).toISOString() }), now), true)

// ── Red: follow-up date has passed (not today, not in the future) ────────
assert.equal(isRedCard(card({ follow_up_date: '2026-10-29' }), now), true)
assert.equal(isRedCard(card({ follow_up_date: '2026-10-30' }), now), false)
assert.equal(isRedCard(card({ follow_up_date: '2026-11-02' }), now), false)

// ── First sale is never red ──────────────────────────────────────────────
assert.equal(isRedCard(card({
  step: 'first_sale',
  step_changed_at: new Date(now.getTime() - 10 * DAY).toISOString(),
  first_sale_at: new Date(now.getTime() - 10 * DAY).toISOString(),
  follow_up_date: '2026-01-01',
}), now), false)

// ── Off the board: First sale for more than 7 days ───────────────────────
const sold = (days: number) => card({
  step: 'first_sale',
  first_sale_at: new Date(now.getTime() - days * DAY).toISOString(),
})
assert.equal(isOffBoard(sold(6), now), false)
assert.equal(isOffBoard(sold(8), now), true)
assert.equal(isOffBoard(card({ step: 'delivered' }), now), false)

// ── Oldest first ─────────────────────────────────────────────────────────
const older = { step_changed_at: '2026-10-20T00:00:00Z' }
const newer = { step_changed_at: '2026-10-29T00:00:00Z' }
assert.deepEqual([newer, older].sort(compareOldestFirst), [older, newer])

// ── Shipment block (DOs and packing slips) ───────────────────────────────
assert.deepEqual(shipmentLines(null), [])
assert.deepEqual(shipmentLines({ address: null, contact: '  ', pic: '' }), [])
assert.deepEqual(shipmentLines({ address: '12 Jalan A\n\nKuala Lumpur', contact: '012-3', pic: 'Ali' }), [
  '12 Jalan A', 'Kuala Lumpur', 'Attn: Ali', 'Contact: 012-3',
])
assert.deepEqual(shipmentLines({ address: null, contact: '012-3', pic: null }), ['Contact: 012-3'])

async function slipLayoutChecks() {
  // A slip with shipment details must still lay out (the top block grows, so
  // fewer rows fit on the first label).
  const slipItems: SlipItem[] = Array.from({ length: 30 }, (_, i) => ({
    sku: `A${i + 1}`, name: `Plain Series - Ankle - Colour ${i + 1}`, category: 'ankle', quantity: 2,
  }))
  const base = { doNumber: 'DO-2026-0001', createdAt: '2026-10-30T02:00:00Z', storeName: 'Test Store', address: '1 Jalan Test', postcode: '50000', city: 'KL', state: 'WP', picName: 'Siti', picPhone: '0123', items: slipItems }
  const plain = await buildPackingSlip(base)
  const withShip = await buildPackingSlip({ ...base, shipment: { address: '99 Jalan Ship\nPetaling Jaya', contact: '0198', pic: 'Ahmad' } })
  const rowsOf = (pages: { rows: number }[]) => pages.reduce((n, p) => n + p.rows, 0)
  assert.ok(rowsOf(withShip.pages as { rows: number }[]) > 0)
  assert.ok(rowsOf(withShip.pages as { rows: number }[]) <= rowsOf(plain.pages as { rows: number }[]))
}

slipLayoutChecks().then(() => console.log('onboarding rules: all checks passed'))
