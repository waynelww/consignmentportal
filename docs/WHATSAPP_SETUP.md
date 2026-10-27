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

## 10. Coexistence onboarding of the CS number (after App Review approval)

State on 2026-10-27: App Review submission 1779090393199728 (Tech Provider
app, `whatsapp_business_messaging` + `whatsapp_business_management`) is
**Review in progress**. Until it is approved, Facebook Login for Business only
offers the "General" configuration variation and the Embedded Signup dialog
falls back to the take-over flow, which is why the CS number could not be
connected earlier. Once Meta approves (watch App dashboard → Alert Inbox and
the contact email), do the following — about 20 minutes:

1. **Create the Embedded Signup configuration.** App dashboard → Facebook
   Login for Business → Configurations → Create configuration → variation
   **WhatsApp Embedded Signup** (it only appears after approval) → name
   `xcms-coexistence`, keep the default WhatsApp permissions, save. Copy the
   new **Configuration ID** and set `NEXT_PUBLIC_WA_ES_CONFIG_ID` to it in
   Vercel (and `.env.local`), then redeploy. The old General config
   1153539300575878 can be deleted.
2. **Prepare the CS phone.** WhatsApp Business app on the CS phone updated to
   the latest version, phone unlocked and next to you. Chats stay on the
   phone; nothing is deleted or migrated.
3. **Run the flow.** Logged into Facebook as the Xocks admin in Chrome, open
   `https://consignmentportal.vercel.app/admin/whatsapp/onboard` → **Connect
   WhatsApp number**. In Meta's dialog pick business **Xocks**
   (851885455824098) and the main WABA **Xocks 1839031783476008** (the one
   with the 19 approved templates and the Kaleyra credit line), enter
   **+60 11‑5425 7317**, and choose the option for a number *already using the
   WhatsApp Business app*. A QR code is delivered inside the WhatsApp
   Business app on the CS phone — scan it there. The page lists the
   `WA_EMBEDDED_SIGNUP` events; `FINISH` means done.
4. **Wire the ids.** WhatsApp Manager → Phone numbers (WABA 1839031783476008)
   now shows the CS number with a **Phone number ID**. Set in Vercel and
   `.env.local`: `WHATSAPP_PHONE_NUMBER_ID=<that id>`,
   `WHATSAPP_WABA_ID=1839031783476008`, `WHATSAPP_TIER_LIMIT=2000` (this WABA
   is already at the 2,000/day tier). Subscribe the app to the WABA if the
   flow did not: `POST /1839031783476008/subscribed_apps` with the system-user
   token. Redeploy.
5. **Verify.** `/admin/whatsapp` must now list the 19 Xocks templates; do a
   Test send to your own number and watch it go sent → delivered → read in
   the blast log. Then remove the dead +60 11‑5427 7317 entry
   (1027897073736657) from the WABA.
6. **Coexistence rules for the CS team.** Keep using the WhatsApp Business
   app as before. Someone must open the app at least every ~13 days or API
   sending pauses until it is reopened. API throughput is capped at 20
   msg/s, no group messages via API, and old chat history is not synced to
   XCMS. Replies CS types in the app are invisible to XCMS until Phase 2
   subscribes the `smb_message_echoes` webhook field.
7. The sandbox number +1 555 160 1883 (WABA 1481918227333075) stays available
   for testing XCMS without touching the real number; it can only message the
   5 verified recipients and is free.

If Meta rejects the review, the rejection reason lands in Alert Inbox; fix,
then Review → App Review → resubmit (screencasts and answers are retained).

## Troubleshooting: `(#10) subcode 2593181` "no permission to send on behalf of this WABA"

Seen 2026-10-27 on WABA 709384251831562 (the WABA holding Meta test number
646890128504196). The token, app subscription and `health_status` all looked
fine; Meta's own API Setup "Send message" button refused with "Missing
payment method", and no card could be set as default on the WABA ("We
weren't able to set … as your default payment method").

Cause: the WABA was an old Manychat-era account. Manychat was still assigned
as a **full-access partner** and its (access-removed) partner credit line was
still bound to the WABA, which Meta treats as an *ineligible* payment method
and which blocks any card from becoming default.

Fix: Business Settings → Accounts → Messaging accounts → pick the WABA →
Partners tab → Manychat → Manage → **Remove access**. Sends started working
immediately afterwards (first error changed to `132001 template not found`,
i.e. the permission gate was gone). Card "Set as default" may still fail on
that WABA; service-window replies work regardless.

Related: Meta test numbers can only message up to 5 verified recipients and
templates are per-WABA — the 19 approved Xocks templates live on the main
WABA 1839031783476008, not on the test WABA.
