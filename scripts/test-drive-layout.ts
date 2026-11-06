// Pins the Drive folder/file names and the service-account JWT signing.
// Run: npx tsx scripts/test-drive-layout.ts
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import {
  storeFolderName, subfolderFor, doFileName, invoiceFileName, safeName,
  DO_SUBFOLDER, INVOICE_SUBFOLDER, BACKFILL_FROM_ISO,
} from '../lib/drive/layout'
import { getDriveAccessToken } from '../lib/google/drive'

// ── Layout ──────────────────────────────────────────────────────────────
assert.equal(storeFolderName('XCSM', 'Hyperground'), 'XCSM Hyperground')
assert.equal(storeFolderName('AGK-001', 'Wayne Store'), 'AGK-001 Wayne Store')
assert.equal(safeName('A/B\\C'), 'A-B-C', 'slashes would read as a path')
assert.equal(safeName('  two   spaces  '), 'two spaces')
assert.equal(subfolderFor('delivery_order'), DO_SUBFOLDER)
assert.equal(subfolderFor('invoice'), INVOICE_SUBFOLDER)
assert.equal(doFileName('DO-2026-0007'), 'DO-2026-0007.pdf')
assert.equal(invoiceFileName('XCSM-121', 10, 2026), 'XCSM-121 (Oct 2026).pdf', 'example from the spec')
assert.equal(invoiceFileName('XCSM-100', 1, 2027), 'XCSM-100 (Jan 2027).pdf')
assert.throws(() => invoiceFileName('XCSM-100', 13, 2026), /Invalid invoice period month/)
// 1 Nov 2026 00:00 Malaysia time is 31 Oct 16:00 UTC
assert.equal(BACKFILL_FROM_ISO, '2026-10-31T16:00:00.000Z')
assert.equal(new Date(BACKFILL_FROM_ISO).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' }), '01/11/2026, 00:00:00')

async function main() {
// A broken key must give a short error that does not echo the JSON.
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email": "x", "private_key": '
await assert.rejects(getDriveAccessToken(), (err: Error) => {
  assert.equal(err.message, 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON')
  return true
})


// ── Service-account JWT (offline: fetch is stubbed) ─────────────────────
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'xcms-test@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
})

const realFetch = globalThis.fetch
let captured: URLSearchParams | null = null
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  captured = new URLSearchParams(String(init?.body))
  return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
}) as typeof fetch

try {
  const token = await getDriveAccessToken()
  assert.equal(token, 'test-token')
  assert.ok(captured, 'token request was sent')
  const params = captured as URLSearchParams
  assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  const [header, claims, signature] = (params.get('assertion') ?? '').split('.')
  const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))
  assert.deepEqual(decode(header), { alg: 'RS256', typ: 'JWT' })
  const body = decode(claims)
  assert.equal(body.iss, 'xcms-test@example.iam.gserviceaccount.com')
  assert.equal(body.scope, 'https://www.googleapis.com/auth/drive')
  assert.equal(body.aud, 'https://oauth2.googleapis.com/token')
  assert.ok(body.exp - body.iat === 3600)
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${header}.${claims}`)
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, 'base64url')), 'JWT signature verifies')
  console.log('✓ service-account JWT is well formed and signed')
} finally {
  globalThis.fetch = realFetch
}

console.log('✓ Drive layout and service-account checks passed')
}

main().catch((err) => { console.error(err); process.exit(1) })
