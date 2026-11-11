// Tests for the store login reset helpers (lib/stores/welcome-message.ts and temp-password.ts).
// Run: npx tsx scripts/test-store-login.ts
import assert from 'node:assert/strict'
import { buildWelcomeMessage, whatsappUrl } from '../lib/stores/welcome-message'
import { generateTempPassword, TEMP_PASSWORD_LENGTH } from '../lib/stores/temp-password'

// ── Welcome message: must match the text Add Store sent before it was moved to lib ──
const loginUrl = 'https://consignmentportal.vercel.app/login'
const original = `Hi Ali! 👋

Welcome to Xocks. Here are your login details for Kedai Sock:

🔗 Login link: ${loginUrl}
📧 Email: ali@example.com
🔑 Temporary password: ABCD2345EF

For security, please change your password after first login:
1. Log in with the password above
2. Tap the Account tab at the bottom
3. Tap "Change Password"
4. Set a strong password you'll remember

Need help? Check the tutorial guide in the Account tab.

After you log in, please sign your first delivery order under Delivery Orders.

Welcome aboard! 🧦`

assert.equal(
  buildWelcomeMessage({ picName: 'Ali', storeName: 'Kedai Sock', loginUrl, email: 'ali@example.com', password: 'ABCD2345EF' }),
  original,
  'shared message matches the Add Store text exactly',
)

// Fallbacks as Add Store had them: "there" for a missing name, "your store" for a blank store name.
const fallback = buildWelcomeMessage({ picName: undefined, storeName: '', loginUrl, email: 'x@y.co', password: 'PW' })
assert.ok(fallback.startsWith('Hi there! 👋'), 'missing PIC name falls back to "there"')
assert.ok(fallback.includes('login details for your store:'), 'blank store name falls back to "your store"')

// ── WhatsApp link: non-digits stripped, leading 0 becomes 60 ──
const text = 'hello there'
assert.equal(whatsappUrl('012-345 6789', text), `https://wa.me/60123456789?text=${encodeURIComponent(text)}`)
assert.equal(whatsappUrl('60123456789', text), `https://wa.me/60123456789?text=${encodeURIComponent(text)}`)
assert.equal(whatsappUrl(null, text), `https://wa.me/?text=${encodeURIComponent(text)}`, 'missing phone gives an empty number, not a crash')

// ── Temporary password: 10 characters, same alphabet as generateRef, not reused ──
const ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/
const seen = new Set<string>()
for (let i = 0; i < 200; i++) {
  const pw = generateTempPassword()
  assert.equal(pw.length, TEMP_PASSWORD_LENGTH)
  assert.ok(ALPHABET.test(pw), `only the Add Store alphabet: ${pw}`)
  seen.add(pw)
}
assert.equal(seen.size, 200, 'passwords do not repeat in 200 draws')

console.log('store login tests passed')
