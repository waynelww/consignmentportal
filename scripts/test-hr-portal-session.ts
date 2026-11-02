// Unit test for the HR link security: password/PIN hashing and signed cookies.
// Run: npx tsx scripts/test-hr-portal-session.ts
import assert from 'node:assert/strict'

import {
  hashSecret, verifySecret, gateToken, memberToken, hasGate, portalMember, GATE_COOKIE, MEMBER_COOKIE, PIN_PATTERN,
} from '../lib/hr/portal-session'

// Read lazily by the signing code, so setting it here is enough.
process.env.HR_PORTAL_SECRET = 'test-secret'

async function main() {

// ── Hashing ──────────────────────────────────────────────────────────────
const h = hashSecret('1234')
assert.ok(h.startsWith('scrypt$'))
assert.notEqual(hashSecret('1234'), h, 'random salt: same PIN hashes differently')
assert.ok(verifySecret('1234', h))
assert.ok(!verifySecret('1235', h))
assert.ok(!verifySecret('1234', null))
assert.ok(!verifySecret('1234', 'garbage'))
assert.ok(PIN_PATTERN.test('1234') && PIN_PATTERN.test('123456'))
assert.ok(!PIN_PATTERN.test('123') && !PIN_PATTERN.test('1234567') && !PIN_PATTERN.test('12a4'))

// ── Fake request + database ──────────────────────────────────────────────
type Cookies = Record<string, string>
const req = (cookies: Cookies) => ({ cookies: { get: (k: string) => (k in cookies ? { value: cookies[k] } : undefined) } }) as never
function db(passwordHash: string | null, member: Record<string, unknown> | null) {
  const chain = (row: unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) c[m] = () => c
    c.maybeSingle = async () => ({ data: row })
    return c
  }
  return { from: (t: string) => chain(t === 'hr_secrets' ? (passwordHash === null ? null : { value: passwordHash }) : member) } as never
}

const pw = hashSecret('HRXocks-test')
const pin = hashSecret('4321')
const member = { id: 'm1', name: 'Aisyah', active: true, hr_pin_hash: pin }
const gate = gateToken(pw)
const mem = memberToken('m1', pin)

// Gate
assert.equal(await hasGate(req({ [GATE_COOKIE]: gate }), db(pw, member)), true)
assert.equal(await hasGate(req({}), db(pw, member)), false, 'no cookie')
assert.equal(await hasGate(req({ [GATE_COOKIE]: gate }), db(hashSecret('new-password'), member)), false, 'password changed → old cookie dead')
assert.equal(await hasGate(req({ [GATE_COOKIE]: gate }), db(null, member)), false, 'link not set up')
const [body, mac] = gate.split('.')
const forged = Buffer.from(JSON.stringify({ t: 'gate', v: 'x', exp: 9e9 })).toString('base64url')
assert.equal(await hasGate(req({ [GATE_COOKIE]: `${forged}.${mac}` }), db(pw, member)), false, 'tampered body')
assert.equal(await hasGate(req({ [GATE_COOKIE]: `${body}.AAAA` }), db(pw, member)), false, 'tampered signature')

// Member
const both = { [GATE_COOKIE]: gate, [MEMBER_COOKIE]: mem }
assert.deepEqual(await portalMember(req(both), db(pw, member)), { id: 'm1', name: 'Aisyah' })
assert.equal(await portalMember(req({ [MEMBER_COOKIE]: mem }), db(pw, member)), null, 'needs the gate too')
assert.equal(await portalMember(req(both), db(pw, { ...member, hr_pin_hash: null })), null, 'PIN reset → signed out')
assert.equal(await portalMember(req(both), db(pw, { ...member, hr_pin_hash: hashSecret('9999') })), null, 'new PIN → old cookie dead')
assert.equal(await portalMember(req(both), db(pw, { ...member, active: false })), null, 'hidden name')
assert.equal(await portalMember(req({ [GATE_COOKIE]: gate, [MEMBER_COOKIE]: gate }), db(pw, member)), null, 'gate cookie is not a member cookie')

console.log('✓ HR link sessions: all assertions passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
