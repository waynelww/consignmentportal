# WhatsApp Cloud API — one-time Meta setup

Everything the code needs is already deployed; this is the manual Meta-side
setup (done once, ~1–2 hours plus Meta's review waits). Direct Cloud API, no
BSP — the only ongoing cost is Meta's per-message fee (Malaysia, Oct 2026:
marketing ≈ RM0.35, utility ≈ RM0.056; service conversations free for the
first 1,000/month).

## 1. Meta app with the WhatsApp product

1. Go to https://developers.facebook.com → **My Apps → Create App**.
2. Type **Business**, link it to the Xocks **Meta Business Manager** (you
   already control it).
3. On the app dashboard, **Add product → WhatsApp → Set up**. This creates a
   **WhatsApp Business Account (WABA)** under the Business Manager and a free
   test number you can ignore.

## 2. The phone number — coexistence vs new number

Two options; **coexistence is the recommended one** for Xocks because the CS
team keeps replying from the WhatsApp Business app they already use:

- **Coexistence (existing number):** in WhatsApp Manager → Phone numbers →
  **Add phone number**, choose to connect the number already used in the
  WhatsApp **Business app** and scan the QR shown there (app must be
  up to date). Limits: 20 msg/s API throughput, the app must be opened at
  least every 14 days (keep a weekly habit), no group messaging via API, and
  chat history does not sync to the API.
- **New number:** cleanest, but CS replies would have to go through the API
  (Phase 2) — only pick this if the existing number can't be onboarded.

Either way, note the **Phone number ID** (WhatsApp Manager → API Setup, or
App dashboard → WhatsApp → API Setup) and the **WABA ID** (shown on the same
page).

## 3. Business verification (unlocks the 2,000 tier)

Unverified businesses are stuck at the lowest tier. In **Business Manager →
Settings → Security Centre → Start verification**, submit SSM documents for
WAYNE GROUP HOLDING SDN BHD (name/address on documents must match the
Business Manager profile). Takes days to a couple of weeks.

Messaging tiers (unique recipients per rolling 24h): **250 → 1,000 → 2,000 →
unlimited**. Upgrades are automatic: send to at least half your current tier
within 7 days while keeping quality rating healthy (warm up — don't blast
2,000 stores on day one). The current limit shows in WhatsApp Manager →
phone number → Insights. **When Meta raises the tier, update the
`WHATSAPP_TIER_LIMIT` env var in Vercel** so the blast page's cap matches.

## 4. System-user token (never expires)

1. **Business Manager → Settings → Users → System users → Add**: name e.g.
   `xcms-whatsapp`, role **Admin**.
2. **Add assets** to it: the Meta app (full control) — the WABA access comes
   through the app.
3. **Generate new token**: select the app, expiry **never**, permissions
   **`whatsapp_business_messaging`** and **`whatsapp_business_management`**.
4. Copy the token immediately (shown once). This is `WHATSAPP_TOKEN`.

## 5. Env vars

Add to `.env.local` AND Vercel project env vars (then redeploy):

| Var | Value |
|---|---|
| `WHATSAPP_TOKEN` | system-user token from step 4 |
| `WHATSAPP_PHONE_NUMBER_ID` | from API Setup page |
| `WHATSAPP_WABA_ID` | from API Setup page (template listing) |
| `WHATSAPP_VERIFY_TOKEN` | any random string you invent (webhook handshake) |
| `WHATSAPP_APP_SECRET` | App dashboard → App settings → Basic → App secret (webhook signature check) |
| `WHATSAPP_TIER_LIMIT` | current tier cap, e.g. `250` (optional, defaults to 250) |
| `WHATSAPP_GRAPH_VERSION` | optional, defaults to `v24.0` |

## 6. Webhook

App dashboard → **WhatsApp → Configuration**:

- Callback URL: `https://consignmentportal.vercel.app/api/wa/webhook`
- Verify token: the `WHATSAPP_VERIFY_TOKEN` value (env must be deployed on
  Vercel FIRST — Meta calls the URL during the handshake).
- Click **Verify and save**, then under Webhook fields **subscribe to
  `messages`** (that one field carries inbound messages AND status events).

## 7. Database migration

Paste `supabase/migrations/20261026_whatsapp_cloud_api.sql` into the
Supabase dashboard SQL editor and run it (house rule: nothing applies
migrations automatically).

## 8. Message template

Blasts can only use pre-approved templates. In **WhatsApp Manager →
Message templates → Create**: category (Marketing for store blasts — Utility
only for transactional content like invoice reminders, it's 6× cheaper when
it genuinely qualifies), language (en or ms), body text with `{{1}}`-style
variables. Approval is usually minutes to hours. For a quick end-to-end test
the pre-existing `hello_world` (en_US) template also works.

## 9. End-to-end test

`/admin/whatsapp` → pick the template → **Test send** to your own number.
You should get the message on WhatsApp, and after opening it the blast log
row should move sent → delivered → read (webhook round-trip proven).

## Day-to-day rules

- Blast audience = active stores' PIC phones, auto-deduped and normalized;
  contacts who replied STOP/UNSUBSCRIBE/BERHENTI are opted out automatically
  and always excluded.
- The blast page previews cost and caps to the tier's remaining 24h
  allowance; the remainder goes in a follow-up blast after the window rolls.
- Warm-up: grow volume gradually, watch the quality rating in WhatsApp
  Manager — a Red rating can freeze the tier or drop it.
- Coexistence: someone must open the WhatsApp Business app at least every
  ~13 days or API sending stops until it's reopened.
