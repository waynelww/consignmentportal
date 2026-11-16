// Pins the Drive folder/file names and the service-account JWT signing.
// Run: npx tsx scripts/test-drive-layout.ts
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import {
  storeFolderName, subfolderFor, doFileName, invoiceFileName, safeName, receiptFileName,
  receiptExtension, stripFileNameChars, malaysiaYearMonth, monthYearLabel,
  DO_SUBFOLDER, INVOICE_SUBFOLDER, RECEIPT_SUBFOLDER, BACKFILL_FROM_ISO,
} from '../lib/drive/layout'
import { getDriveAccessToken } from '../lib/google/drive'
import { deliveryOrderCopyWanted } from '../lib/drive/queue'

// ── Layout ──────────────────────────────────────────────────────────────
assert.equal(storeFolderName('XCSM', 'Hyperground'), 'XCSM Hyperground')
assert.equal(storeFolderName('AGK-001', 'Wayne Store'), 'AGK-001 Wayne Store')
assert.equal(safeName('A/B\\C'), 'A-B-C', 'slashes would read as a path')
assert.equal(safeName('  two   spaces  '), 'two spaces')
assert.equal(subfolderFor('delivery_order'), DO_SUBFOLDER)
assert.equal(subfolderFor('invoice'), INVOICE_SUBFOLDER)
assert.equal(subfolderFor('payment_receipt'), RECEIPT_SUBFOLDER)
assert.equal(RECEIPT_SUBFOLDER, 'Payment Receipts')
// Payment receipts: <store_name> – <Month YYYY>.<ext>, period = the invoice month
assert.equal(
  receiptFileName('HYPRGROUND HOLDING SDN BHD', 10, 2026, 'image/jpeg'),
  'HYPRGROUND HOLDING SDN BHD – October 2026.jpg',
  'example from the spec',
)
assert.equal(receiptFileName('Wayne Store', 1, 2027, 'application/pdf'), 'Wayne Store – January 2027.pdf')
assert.equal(receiptFileName('Wayne Store', 12, 2026, 'image/png'), 'Wayne Store – December 2026.png')
assert.equal(receiptFileName('Wayne Store', 11, 2026, 'image/webp'), 'Wayne Store – November 2026.webp')
assert.equal(receiptFileName('Wayne Store', 11, 2026, 'image/heic'), 'Wayne Store – November 2026.heic')
assert.equal(stripFileNameChars('A/B\\C:D*E?F"G<H>I|J'), 'ABCDEFGHIJ', 'forbidden characters are removed, not replaced')
assert.equal(receiptFileName('  Spaced   Name  ', 10, 2026, 'image/jpeg'), 'Spaced Name – October 2026.jpg')
assert.throws(() => receiptFileName('X', 10, 2026, 'image/gif'), /Unsupported receipt type/)
assert.throws(() => receiptFileName('X', 0, 2026, 'image/jpeg'), /Invalid month/)
assert.equal(receiptExtension('application/pdf'), 'pdf')
// One naming style for every file: "<store_name> – <Month YYYY>…", en dash.
// Invoice: Month YYYY = the period the invoice is for.
assert.equal(
  invoiceFileName('HYPRGROUND HOLDING SDN BHD', 10, 2026),
  'HYPRGROUND HOLDING SDN BHD – October 2026.pdf',
  'example from the spec',
)
assert.equal(invoiceFileName('Wayne Store', 1, 2027), 'Wayne Store – January 2027.pdf')
assert.equal(invoiceFileName('A/B: Store?', 3, 2026), 'AB Store – March 2026.pdf', 'forbidden characters stripped')
assert.throws(() => invoiceFileName('X', 13, 2026), /Invalid month/)
assert.equal(monthYearLabel(11, 2026), 'November 2026')
// DO: Month YYYY = the month the DO was created, in Malaysia time; DO number keeps it unique
assert.equal(
  doFileName('Niqez Store Enterprise', 'DO-2026-0062', '2026-11-10T04:00:00Z'),
  'Niqez Store Enterprise – November 2026 (DO-2026-0062).pdf',
  'example from the spec',
)
assert.equal(
  doFileName('Wayne Store', 'DO-2026-0001', '2026-10-31T20:30:00Z'),
  'Wayne Store – November 2026 (DO-2026-0001).pdf',
  '31 Oct 20:30 UTC is already 1 Nov in Malaysia',
)
assert.equal(
  doFileName('Wayne Store', 'DO-2026-0002', '2026-10-31T15:30:00Z'),
  'Wayne Store – October 2026 (DO-2026-0002).pdf',
  '31 Oct 15:30 UTC is 31 Oct 23:30 in Malaysia',
)
assert.equal(doFileName('A/B: Store?', 'DO/2026:1', '2026-11-05T02:00:00Z'), 'AB Store – November 2026 (DO20261).pdf')
assert.deepEqual(malaysiaYearMonth('2026-12-31T17:00:00Z'), { year: 2027, month: 1 }, 'year rolls over in Malaysia time')
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


assert.equal(deliveryOrderCopyWanted('acknowledged'), true)
for (const s of ['draft', 'confirmed', 'dispatched', 'delivered', undefined, null]) {
  assert.equal(deliveryOrderCopyWanted(s as string), false, `${s} is not uploaded`)
}

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
