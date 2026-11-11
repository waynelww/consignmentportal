// Tests for the store's first-DO signature rule (lib/delivery-orders/initial-signature.ts).
// Run: npx tsx scripts/test-initial-do-signature.ts
import assert from 'node:assert/strict'
import { needsStoreSignature, INITIAL_DO_SIGNATURE_FROM } from '../lib/delivery-orders/initial-signature'

const NEW = '2026-11-11T09:30:00.123456+00:00' // after the cutoff
const OLD = '2026-11-10T15:59:59+00:00'         // one second before the cutoff (MYT midnight = 16:00 UTC)

const base = { do_type: 'initial', status: 'acknowledged', pdf_url: null, created_at: NEW }

// Flagged: new initial DO, received, not signed
assert.equal(needsStoreSignature(base), true, 'new unsigned initial DO needs a signature')

// Signed → not flagged any more
assert.equal(needsStoreSignature({ ...base, pdf_url: 'STR-001/x.pdf' }), false, 'signed DO is not flagged')

// Restock / return DOs never flagged
assert.equal(needsStoreSignature({ ...base, do_type: 'restock' }), false, 'restock DO not flagged')
assert.equal(needsStoreSignature({ ...base, do_type: 'return' }), false, 'return DO not flagged')

// Not yet received (the store cannot sign before receiving) → not flagged here
for (const status of ['draft', 'confirmed', 'dispatched', 'delivered']) {
  assert.equal(needsStoreSignature({ ...base, status }), false, `status ${status} not flagged`)
}

// Older stores' initial DOs are never flagged
assert.equal(needsStoreSignature({ ...base, created_at: OLD }), false, 'initial DO before the cutoff not flagged')

// The cutoff itself counts as "from now on"
assert.equal(needsStoreSignature({ ...base, created_at: INITIAL_DO_SIGNATURE_FROM }), true, 'DO exactly at the cutoff is flagged')

console.log('initial DO signature rule: all checks passed')
