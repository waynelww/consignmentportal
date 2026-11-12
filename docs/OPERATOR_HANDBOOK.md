# XCMS Operator Handbook

Read this first. It is written for the person (and their Claude) taking over
day-to-day operation of XCMS — everything here was learned the hard way while
building the system.

## What XCMS is

Xocks Consignment Management System for the Xocks sock brand (Malaysia).
Live at **https://consignmentportal.vercel.app**. One Next.js app serving:

- **Consignment core** — stores, products, stock, sales, monthly commission
  invoices (`XCSM-###` numbering), payments and receipt review.
- **Operations** — restock queue + predictions, delivery orders, booth events
  (inventory checkout/return) and the Event Target Calculator.
- **Xocks Gang CRM** — public page at `/gang`: customers register orders,
  get monthly lucky-draw tickets, first-timers get two personal Shopify
  discount codes. Website orders auto-enroll via a Shopify webhook.
- **OEM calculator**, reports, exports, admin settings.

## Stack and where things run

| Piece | Where | Access needed |
|---|---|---|
| Code | GitHub `waynelww/consignmentportal` | repo collaborator |
| Hosting | Vercel (Hobby) — auto-deploys every push to `main` | push access = deploy ability |
| Database | Supabase project `mhdyurnrmpjxsjbhbxrp` | dashboard invite |
| Shop | Shopify store `3127c9.myshopify.com` (xocks.co) | staff account if dashboard work needed |
| Email marketing | Klaviyo | account invite if flows/templates needed |
| Transactional email | Resend | key in env |
| Monthly crons | GitHub Actions (`.github/workflows/`) | comes with repo access |

Secrets live in `.env.local` (never committed — get it from Wayne through a
password manager or AirDrop, never chat/email) and mirrored in Vercel project
env vars. Key names: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `CRON_SECRET`, `RESEND_API_KEY`.

## Hard-won rules — do not relearn these

1. **No psql / no ad-hoc DDL.** Schema changes are written as SQL files in
   `supabase/migrations/` first, then applied with the Supabase connector's
   `apply_migration` tool (not pasted by hand) — only after showing the
   current XCMS operator (whoever is running the session) the SQL and
   getting their explicit OK. The connector is scoped to project
   `mhdyurnrmpjxsjbhbxrp` (XCMS) only; never touch any other project.
   **Never drop or delete tables or data without the current operator's
   explicit approval.** Data reads/writes can use the REST API with the service key.
2. **`npx next build` does NOT catch TypeScript errors** (build config
   ignores them). Always also run `npx tsc --noEmit -p tsconfig.json`.
   A handful of pre-existing implicit-`any` errors are known and ignorable.
3. **This Next.js version differs from training data.** Read
   `node_modules/next/dist/docs/` before writing framework code (AGENTS.md).
4. **Vercel Hobby has a 60s function ceiling.** A killed function returns an
   empty body, which Safari surfaces as "The string did not match the
   expected pattern". Long jobs must batch/parallelise (see
   `lib/shopify/sync-inventory.ts`) and clients must guard `res.json()`.
5. **Vercel Hobby caps at 2 cron jobs** — that's why monthly invoices and
   backups run from GitHub Actions instead (`CRON_SECRET`-protected
   endpoints, retried, idempotent).
6. **Money semantics:** `commission_amount` = the store's cut;
   `xocks_revenue` = what the store must transfer to Xocks
   (revenue − commission). Stores pay by the 7th. Never confuse the two.
7. **Invoice numbers (`XCSM-###`)** are permanent: assigned MAX+1 under a
   unique index (never COUNT — deletions must not reissue), backfilled
   001–042, generation-time numbers start at 100. Paid invoices' stored
   PDFs are immutable; pending ones may be regenerated.
8. **Sequential-code pattern:** anything needing gap-free-ish sequences
   (ticket numbers, invoice numbers, DO numbers) uses MAX+1 + retry on
   Postgres error 23505. Generic helper: `lib/sequence-code.ts`.
9. **Gang discount codes** avoid the characters O/I/L/0
   (`lib/gang/first-timer.ts`), are customer-restricted on Shopify, and the
   Shopify custom app token needs `write_discounts` + `write_customers`
   (already granted — app "Performance Tracker Integration").
10. **Gang webhook** (`/api/gang/shopify-webhook`): treats the payload only
    as "look up order X" — all facts re-fetched from Shopify; only
    `sourceName === 'web'` orders auto-enroll (POS/wholesale must not);
    always returns 200 to avoid Shopify retry storms.
11. **Verify on the deployed site, not just locally** — several past bugs
    only appeared under Vercel's limits.

## WhatsApp (Cloud API)

Store blasts and CS tracking run on Meta's WhatsApp Cloud API directly (no
BSP) — one-time Meta setup is in `docs/WHATSAPP_SETUP.md`. The moving parts:

- **Admin page** `/admin/whatsapp`: template blasts to active stores' PIC
  phones (preview → send in batches of 25 per invocation, resumable), test
  send, per-recipient delivery/read status, CS first-response times.
- **Webhook** `/api/wa/webhook`: Meta posts inbound messages + status
  events; signature-checked (`WHATSAPP_APP_SECRET`), always returns 200 to
  processing failures (like the Gang webhook, retry-storm avoidance).
- **Tables** `wa_contacts` / `wa_messages` / `wa_blasts` — one message log
  for both directions keyed by `conversation_key` (normalized phone, via
  `normalizePhone`), designed so the Phase 2 AI auto-replier can read whole
  threads. Raw inbound payloads kept in `wa_messages.payload`.
- **Tier awareness**: Meta caps unique recipients per rolling 24h
  (250/1,000/2,000…). `WHATSAPP_TIER_LIMIT` env var mirrors the current
  tier — bump it in Vercel when Meta upgrades the tier, or blasts will cap
  too early. Opt-outs (STOP/UNSUBSCRIBE/BERHENTI inbound) are honoured
  automatically.
- **Coexistence caveat**: CS replies typed in the WhatsApp Business app are
  invisible to the Cloud API (and the response-time metric) until app-echo
  webhooks are added; keep opening the Business app at least every ~13 days
  or API sending stops.
- Env keys: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
  `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TIER_LIMIT`.
- Cost: marketing template ≈ RM0.35/msg (the launch dialog shows the total);
  utility ≈ RM0.056; inbound/service free for the first 1,000 convos/month.

## Performance dashboard & Shopify orders sync

`/admin/performance` shows revenue across channels (website via synced
Shopify orders, marketplaces via manual CSV upload on the same page).
A GitHub Action (`sync-shopify-orders.yml`) calls
`/api/cron/sync-shopify-orders` every 2 hours; tables come from
`supabase/migrations/20261026_performance_channels.sql` — like every
migration, it must be pasted into the Supabase SQL editor before the
feature (or the cron) works.

## Restock Calculator (Wayne's method)

`/admin/restock-calculator` (super_admin + ops_manager), one store at a
time. Maths lives only in `lib/restock/wayne-calc.ts`; test with
`npx tsx scripts/test-wayne-calc.ts` (pins live data for Hyperground STR-015
and ONE NINE NINE STR-019 as of 27 Oct 2026). Separate from
`/admin/predictions`, which is unchanged.

- Period = 2 or 3 months (user's choice, remembered per user in the
  browser) counted back from the store's **last recorded sale**: end = last
  sale, start = end − N months + 1 day (last sale 26 Oct, 3 months →
  27 Jul – 26 Oct). Pairs/month = pairs in the period ÷ months covered. The
  period is split into N one-month blocks ending on the last sale for the
  per-month figures and the consistency check.
- Short history: if the first sale is after that start, the period starts
  at the first sale and months covered = (last − first sale days) ÷ 30.4
  (min 1), with a warning. Under 1 month of sales → "start with 30–50
  pairs", no calculation. Because the period ends on the last sale, the
  "last sale more than 7 days ago" warning matters: unentered sales are
  simply not counted.
- Pairs = sales RM ÷ price per pair; a product counts as Special Patches
  when its `selling_price` ≥ the `restock_calc_special_min_selling_price`
  setting (RM19), otherwise Plain. Prices, multipliers, the consistency %
  and stale-sale days are `restock_calc_*` rows in `public.settings`,
  editable from the page.
- **Split across codes** (`restock_calc_split_mode`, default `even`). The
  target is shared evenly across the codes the store carries: each code's
  target = target ÷ number of codes, **rounded up** to a whole pair, and send =
  max(0, code target − on hand). The total target is codes × that figure, so it
  can be a few pairs above pairs/month × 4 ("Target (sum of rounded-up codes)").
  Sold (pairs) and Share columns are for information only in this mode.
- **Switching back to the old method:** Restock Calculator → Settings →
  "Split target across codes" → **By sales share (old method)** → Save
  settings. Each code's target is then target × that code's share of pairs
  sold in the period, rounded to the nearest pair (the previous behaviour).
  Settings apply to the next calculation; plan levels follow at the next daily
  run or with "Recalculate plan".
- The split is stored in each saved calculation's `settings` (JSON). Calculations
  saved before this change have no `split_mode` key and were made by sales share.
- No migration is needed: the setting has a code default (`even`) and the first
  "Save settings" writes the row.
- Nothing is saved on selecting a store or changing 2/3 months. "Save
  calculation" (or "Create restock request", which saves first and links
  the two) writes a row in `restock_calculations`: `period_start` /
  `period_end` = actual dates used, `end_month` = month of the last sale,
  and `settings.period` holds months chosen, months covered and the
  short-history flag (no schema change). Rows are append-only (DB
  trigger): never deleted, only voided with a reason. "Create restock
  request" goes through the normal Restock Queue.
- Read-only bot endpoint: `/api/bot/restock-calc?months=2|3&store_code=`.

## Low stock (stocked levels)

Rule lives only in `lib/restock/low-stock.ts` (pinned by
`npx tsx scripts/test-low-stock.ts`); plan maths stays in `wayne-calc.ts`.

- **Stocked level per code.** Default = the store's `stores.pairs_per_code`
  (set on the new-store form and the store page; default 3). An admin can
  override one code (`store_inventory.stocked_level`, source `manual`) or
  set every code at once ("Set all codes to N", which also clears overrides).
  Delivery orders do not change stocked levels.
- **4-month plan.** A store whose average monthly RM sales over the last
  `restock_plan_avg_months` (3) is at least `restock_plan_min_monthly_sales`
  (RM250) is on the plan (`stores.on_stock_plan`). Its total is the
  4-month quantity from `wayne-calc.ts`, split across carried codes the same way
  as the Restock Calculator (even and rounded up by default; see "Split across
  codes" above), minimum 1 pair per code, so the total can be a few pairs over.
  Plan levels are read-only; they refresh in the 09:00 MYT daily job, or
  with "Recalculate plan" on the store page.
- **Low:** `0 < on hand ≤ max(1, stocked × low_stock_pct / 100)`
  (`low_stock_pct` = 50). **Out:** 0. **Store needs restock:** total on hand
  below `low_stock_pct`% of total stocked, shown as "X of Y pairs (Z%)".
- **Alerts:** no in-app, push or WhatsApp low-stock notifications. A
  `restock_alerts` row is kept for each new low/out code (feeds the
  dashboard). The daily email is the only alert.
- **Daily email:** `.github/workflows/low-stock-summary.yml` calls
  `/api/cron/low-stock-summary` at 09:00 MYT. It refreshes the plan levels,
  then emails `low_stock_alert_email` (vaernandbk@gmail.com) through
  Resend: stores needing restock, worst first, with their low codes.
- Migration `supabase/migrations/20261029_low_stock_levels.sql` backfills
  `stores.pairs_per_code` from the most common quantity on each store's
  initial DO (ties go to the larger quantity; no initial DO → 3). It does
  not touch `store_inventory` quantities. `restock_threshold` is no longer
  read and can be dropped in a later migration.

## Office (HQ) stock: red and amber warnings

The restock screens show live stock from the Shopify **Office (HQ)** location
only. Nothing else (no other Shopify location) feeds these numbers.

- **Where the numbers come from:** the Shopify location "Office (HQ)"
  (`gid://shopify/Location/97815986484`). Stored per product as
  `products.hq_available_qty` with `products.hq_synced_at`. Matched by SKU.
  Rule: `lib/stock/hq-availability.ts`; sync: `lib/shopify/sync-inventory.ts`.
- **Red "Out at HQ":** Office (HQ) has 0 of that product.
- **Amber "Only X at HQ":** Office (HQ) has fewer than the pairs being asked
  for. On the Restock Calculator it is the suggested Send; on Restocks it is the
  approved qty; on Delivery Orders it is the line qty; on Stock it is the pairs
  the low codes need to get back to their stocked level.
- **Warnings only.** Nothing is blocked. Admins can still add or approve red and
  amber items.
- **Stores** see only "Currently unavailable" on items HQ has 0 of, never the
  quantities.
- **A product with no record at HQ** counts as 0 (red), and the sync result lists
  up to 20 such SKUs in `not_at_hq_skus`. A product that has never been synced
  shows no colour and "—".
- **Refresh from Shopify** (admin, on Stock, Restocks, Restock Calculator and
  Delivery Orders) runs the same sync as the nightly job and shows "Shopify stock
  updated <time>". It must finish within Vercel's 60s limit.
- **Nightly:** `/api/cron/sync-shopify-inventory` (Vercel cron, 03:30 MYT) refreshes
  the same numbers.
- Migration: `supabase/migrations/20261108_products_hq_stock.sql` adds the two
  columns. It must be applied before the refresh or the restock screens work.
  The old `shopify_inventory_qty` columns are no longer written and are still
  there for now.

### SKU and photo sync (Shopify → XCMS)

- **SKU renames and photo changes** made in Shopify carry over to XCMS on
  **Refresh from Shopify** or in the nightly sync (same function,
  `lib/shopify/sync-inventory.ts`). Only `sku` and `image_url` change; name, price,
  barcode and `is_active` are never touched.
- The sync runs the SKU and photo step **before** the HQ stock step, so a renamed
  product gets its HQ quantity in the same run.
- **Linking:** a product is linked to its Shopify variant (`products.shopify_variant_id`)
  by SKU, only when exactly one variant has it, otherwise by name ("product title -
  variant title", only when exactly one matches).
- **Plain Series shared codes aren't linked by ID.** A code such as A9 that several
  variants share is listed under "Not linked" and stays on SKU matching.
- **History:** every SKU change is logged in `product_sku_changes` (source `refresh`
  or `nightly`). A rename that would clash with another product's SKU is not applied
  and is reported as a conflict.
- The result shows "SKUs updated: OLD → NEW, …", "Photos updated: N", conflicts and
  unlinked products. The nightly run logs the same lines.
- Migration: `supabase/migrations/20261109_shopify_variant_sku_sync.sql` must be
  applied before the next refresh.

### Similar colours (suggestions)

For a Plain Series code (A/H/C + yarn number) that HQ is short of, the warning
also shows up to two "Similar" colours. They are picked by closeness of colour
(CIEDE2000 on each yarn's hex colour, `lib/stock/yarn-colours.ts`), from the
catalogue list only, with the same cut letter and at least 3 pairs at HQ. Colours
with enough stock for the quantity come first. Colours already in the same restock
or DO are skipped. Anything that is not a Plain Series code gets no suggestion.

- **Swap** (Restocks review and DO create/edit) changes that line's colour and
  keeps the quantity. Nothing swaps automatically. On Restocks the swap is saved
  when you press Approve.
- **A swap adds a colour the store may not have carried before.** Check that the
  store wants it before approving.
- **Restock Calculator** shows the suggestions for information only. Add the
  replacement on the request in the Restocks queue.
- **Store restock request** shows the similar colour codes and names only, never
  quantities.

## Stock list reader (paste or photo)

Turns a store's restock list into SKUs and pairs. It appears as **Paste list / photo**
next to the SKU search on the **Create DO** and **Edit DO** modals, and in the
**Add Store** initial stock step. It only fills the Items list. Nothing saves until
you press **Create DO**, **Save** or the store's save, as before.

- **Read list** (no AI): pure parser in `lib/stock-list/parse.ts`. Test with
  `npx tsx scripts/test-stock-list-parse.ts`. Change a rule there and in the test together.
- **Read with AI** (text, plus any photos) and **Read photo** (photos only): `POST
  /api/stock-list/ai-read`, admins only (super_admin, ops_manager). Same Anthropic key
  (`ANTHROPIC_API_KEY`) and model as the AI chat. The rules are in the system prompt in
  `app/api/stock-list/ai-read/route.ts`.
- Photos: JPG or PNG, up to 4. The browser resizes each to about 1600px JPEG (about
  1.2 MB at most) so the request stays under Vercel's 4.5 MB body limit. Photos are never
  stored or logged.
- The AI reply is checked against **active** products. A SKU that is not active, or has no
  clear quantity, goes to "Could not read".
- **Replace current items** (on by default): the read becomes the list. Off: the read is
  added to the existing items and repeated SKUs are summed.
- A SKU with no quantity is added with its pairs box empty and highlighted, and is listed in
  the note. **Create DO**, **Edit DO** and **Add Store** refuse to save until every line has
  pairs above 0, so no zero-pair line reaches a DO or a store's first stock.
- **No Show (V codes)** are never sold to consignment: reported as unread, never added.
- **Cuts:** a line with only Ankle, Half or Crew sets the cut for the lines below. A colour
  in more than one cut is never guessed: it is reported with the possible SKUs.
- The note always says "Check the quantities before saving." Re-read the Items list before saving.

## Test accounts (`stores.is_test`)

Stores used for staff training and system testing are flagged with the
"Test account" toggle on the store edit page (badge `TEST` on the Stores list
and store page). Current test stores: AGK-001 (Wayne Store) and STR-009
(Vaernand store); the flag is set in `supabase/migrations/20261030_store_is_test.sql`.

- A test store works normally in the store app (staff picker, sales,
  inventory) and still shows in the Stores list.
- It is left out of: the admin dashboard (KPIs, charts, Top/Bottom 10, Live
  Activity, Not keying in sales), Monthly Sales (every tab, Sales by staff,
  Monthly Average, CSV exports), the daily low-stock email, the Restock
  Calculator and predictions (including the bot `restock-calc` endpoint), the
  consignment figures on `/admin/performance`, every `/api/bot/*` store report
  (the single-store `store-performance` endpoint returns 404 for a test store),
  and the admin CSV export (`/api/admin/export`: sales, commissions, stores), and
  the Follow-ups checklist (`/admin/followups`).
- Commission invoices are **not** excluded: test stores get the monthly
  invoice like any other store, so they can be tested end to end.
- The rule lives in one place: `lib/stores/test-accounts.ts`
  (`loadTestStoreIds` + `isTestStore`). Every report filters with it; do not
  add a second rule.

## Resend a store owner's login

For a store owner who has forgotten their password or needs the welcome
message again. Admins only (super admin or ops manager).

1. Open **Stores → the store → Overview**. The **Store login** box shows the
   login email (the account's email, which can differ from the store's Email).
2. Pick who you are under **Working as** (the same name as Follow-ups and
   Onboarding). The reset button stays off until you do.
3. Press **Reset password & resend login** and confirm. The owner's current
   password stops working straight away.
4. The new temporary password and the welcome message appear **once**. Press
   **Copy**, or **Send on WhatsApp** (to the store's PIC phone), before you
   leave the tab. Leaving the tab or pressing **Done** clears it from the screen.
5. The password is not stored, logged or emailed. If it is lost, reset again.
6. Every reset is written to **store history** (who did it, and when). The
   last few entries show under the Store login box.
   - If the box shows a red "NOT recorded in store history" warning, the password
     was still reset. Write the reset down by hand and tell whoever runs the
     database.

- API: `GET /api/stores/[storeId]/reset-login` returns the login email and recent
  history (never a password). `POST` takes `{ by_member_id }` and returns the
  password once.
- Table: `store_history` (append-only, admins can read, service role writes).
  Migration `supabase/migrations/20261111_store_history.sql` must be applied
  before resets can be recorded.
- Code: `lib/stores/temp-password.ts` (also used by Add Store),
  `lib/stores/welcome-message.ts` (the same message as Add Store),
  `components/admin/StoreLoginCard.tsx`.

## Automation inventory (GitHub Actions + webhooks)

- `monthly-invoices.yml` — 1st + 2nd of month, generates commission invoices.
- `monthly-report.yml` — 1st of month 09:30 MYT, emails last month's report
  (PDF + Excel) to `monthly_report_email`. See "Monthly report" below.
- `low-stock-summary.yml` — daily 09:00 MYT low-stock email (see Low stock).
- `daily-sales-report.yml` — daily 22:00 MYT internal sales PDFs, batched (see Daily sales report).
- `hr-report.yml` — 1st of month 10:00 MYT, emails last month's HR report (see HR).
- `nightly-backup.yml` — nightly database backup.
- `drive-uploads.yml` — scheduled every 15 min (in practice GitHub runs it only every few hours), uploads any delivery orders and invoices still queued for Google Drive. A backup: most copies upload right away (see Google Drive copies).
- `sync-shopify-orders.yml` — every 2h, pulls Shopify orders for the
  performance dashboard.
- Shopify `ORDERS_PAID` webhook → `/api/gang/shopify-webhook` (Gang
  auto-enrollment).
- Meta webhook → `/api/wa/webhook` (WhatsApp inbound + statuses).
- Gang verification bot: endpoints under `/api/bot/` gated by `BOT_API_KEY`
  — the daily upload of valid orders flips pending Gang submissions to
  valid, assigns tickets and grants first-timer codes (the "6PM" pass).

## Gang extras

- `gang_members.birthday` column exists; two Klaviyo birthday email
  templates are built (XzUjST day-of, U8i5qc day-after) but the Klaviyo
  *flow* that sends them still needs to be created in the Klaviyo UI.
- Speed challenge module (`/api/speed/*`, migration
  `20260910_speed_challenge.sql`): its admin endpoint needs the
  `SPEED_ADMIN_CODE` env var (set in Vercel; add to `.env.local` if
  working on it locally).

## Running in claude.ai/code (cloud)

The cloud environment starts from a fresh clone — anything not in GitHub
does not exist there. Setup script:

```bash
npm install
npx next build
npx tsc --noEmit -p tsconfig.json || true
```

Paste every `.env.local` variable into the cloud environment's secrets.
Node 22 is the known-good version.

## Monthly rhythm

- **1st, 09:00 MYT** — GitHub Action calls `/api/cron/generate-commissions`:
  creates invoices for last month (skip-if-exists, zero-sales stores get
  nothing), assigns invoice numbers, notifies stores (in-app + email + push).
  A sweep retry runs on the 2nd.
- **By the 7th** — stores transfer `xocks_revenue` (bank details are on the
  invoice: WAYNE GROUP HOLDING SDN BHD · CIMB BANK · 8605806682) and upload
  receipts; admin reviews in Payments.
- **Gang draw** — tickets are scoped to the current Malaysia-time month
  (`draw_month`); winners drawn manually, announced on WhatsApp end of month.

## Monthly report (PDF + Excel)

Emailed on the 1st at 09:30 MYT to the `monthly_report_email` setting (never
hard-coded). Settings → General → Monthly Report has **Send test report**
(last month's files to info@xocks.co) and **Download PDF**.

- Rule module: `lib/monthly-report/` — `compute.ts` (all numbers, bands,
  action cards, watch list; pure), `load.ts` (database reads), `pdf.ts`,
  `excel.ts`, `index.ts`. Pinned by `npx tsx scripts/test-monthly-report.ts`.
- Scope: active stores that are not test accounts (`lib/stores/test-accounts.ts`).
  Invoices and Xocks revenue come from `commission_periods` (same numbers as the
  invoices). Store counts for the prior month use today's `status` (no status
  history is kept), so "active stores" last month is an approximation.
- Sales bands: `monthly_report_band_high` (250) and `monthly_report_band_mid`
  (100) settings rows; the restock % is `low_stock_pct`; "not keying in" uses
  `sales_reminder_days`.
- Endpoints: `/api/cron/monthly-report` (CRON_SECRET, `?month=YYYY-MM` to
  re-run a month) and `/api/admin/monthly-report` (admins: GET download, POST
  test send). Nothing is stored; each run rebuilds from the live database.
- Seed rows: `supabase/migrations/20261030_monthly_report_settings.sql`
  (must be applied before the first run, or the cron refuses to send).

## Daily sales report (internal only)

Every day at 22:00 MYT, each store whose **Daily sales report** switch is on
is emailed as a PDF of that day's sales. Recipients are Xocks team addresses in
`store_daily_report_settings` (one row per store), which only admins can read,
so store users never see them. The switch defaults to off and can't be on
without at least one recipient (also enforced by a DB check).

- Set on the new-store form (step 2) and the store page (Edit Store). The store
  page's **Send test report** emails today's sales so far (up to now) to the
  saved recipients, and lists the last sends.
- One email per recipient address with one PDF per store that had sales that
  day. Stores with no sales that day are skipped. Test accounts are excluded
  from the daily run (`lib/stores/test-accounts.ts`).
- "Sales that day" = `sales.sale_date` = that day, keyed in before 22:00 MYT.
  Entries keyed after 22:00 are not in that day's report.
- PDF: the commission invoice layout (`lib/pdf/generate-statement.ts`, daily
  mode): titled "Daily Sales Report", with the sales date in place of the
  invoice number. Sales only: product, code, quantity, price, amount, keyed in
  by, with totals for pairs and sales (RM). No commission figures, payout box,
  amount to transfer, XCSM number or bank details. The email shows pairs and
  sales per store, nothing else.
- Code: `lib/daily-report/` (`settings.ts` rules and dates, `aggregate.ts`
  maths and grouping, `report.ts` reads and PDF, `deliver.ts` sending and
  logging, `send-log.ts`). Pinned by `npx tsx scripts/test-daily-report.ts`.
- Endpoint: `/api/cron/daily-sales-report`, CRON_SECRET-gated, batched by
  recipient (`?offset=&limit=`, max 10 per call, `?date=YYYY-MM-DD` to re-run a
  day). The workflow loops through `next_offset` and fails the run if any send
  failed. A failed batch is retried whole, so a retry can re-email addresses
  that already got theirs before the timeout. Check the send log before re-running.
- Log: `daily_report_sends` (one row per store per recipient per attempt, kind
  `daily` or `test`), shown as "Last sends" on the store page. Migration
  `supabase/migrations/20261101_daily_sales_report.sql` (creates the settings
  table, backfills one row per store, creates the log) must be applied before
  the first run.
- Settings writes go through `PUT /api/stores/[storeId]/daily-report` (admin
  check, then the service role). Missing settings row = off.

## Follow-ups checklist (admin)

`/admin/followups` (Operations → Follow-ups, admins only) is the monthly checklist
of consignment follow-ups. Default month is last month (Malaysia time).

- **Rows:** every active, non-test XCMS store, plus every "extra store" (a store
  that is not in XCMS, added with **+ Add store**). **Hide** keeps a store's past
  ticks; **Restore** brings it back from the bottom of the page.
- **Sales Report, Invoice and Payment are automatic for XCMS stores** and cannot
  be ticked by hand, only noted: Sales Report = a sale keyed in that month
  (`sales.sale_date`); Invoice = a `commission_periods` row for that month;
  Payment = that invoice is `paid` (a receipt that is uploaded but not paid shows
  "receipt uploaded, awaiting review"; a rejected one shows "receipt rejected").
- **Restock is ticked by hand for every store**, XCMS stores included. It is no
  longer read from delivery orders. Each tick is recorded like an extra-store tick.
- **Extra store boxes are ticked by hand.** Every tick, untick and note is a row
  in `followup_log` with who did it (the "Working as" name, shared with
  Onboarding) and when. The log is append-only and each row is a snapshot of the
  cell, so the newest row is its current state. Open a cell (the note icon) to
  see its history.
- **Still to follow up** shows only rows with a box not ticked. The counts at the
  top are how many rows still need each column.
- Rules: `lib/followups/build.ts` (auto rules and assembly) and `lib/followups/entry.ts`
  (what one save writes). Pinned by `npx tsx scripts/test-followups.ts`.
- Migration `supabase/migrations/20261102_followups.sql` creates
  `followup_extra_stores`, `followup_extra_store_history` and `followup_log`.
  It must be applied before the page works.
- Migration `supabase/migrations/20261103_followup_restock_manual.sql` widens the
  `followup_log` shape rule so XCMS restock rows can be ticked. Apply after `20261102`.
- APIs: `GET /api/followups?month=YYYY-MM`, `POST /api/followups/entries`,
  `POST /api/followups/extra-stores`, `PATCH /api/followups/extra-stores/:id`.

## Barcode scanning (store app + admin)

- **Record a Sale** (`/store/record-sale`): the **Scan** button opens the rear
  camera (iPhone Safari and Android Chrome, via ZXing). Each scan adds 1 pair of
  that product, only if the store carries it in stock. Scanning the same pair
  again adds another. Unknown codes and products the store does not carry are
  reported, and the staff member picks the product manually. The staff picker
  rule is unchanged: Confirm Order still asks who keyed in the sale.
- **Matching** lives only in `lib/barcode/normalize.ts`. A 13-digit code starting
  with 0 is the same as the 12-digit UPC-A (`0726529949100` = `726529949100`).
  Pinned by `npx tsx scripts/test-barcode.ts`.
- **Admin → Products**: the **Missing barcode** filter lists products with no
  barcode. **Scan to set barcode** (row icon, or the button in the product form)
  saves the code straight after one read. A code another product already has
  shows a warning; "Save anyway" is recorded.
- Barcodes are no longer typed in the product form. Every change goes through
  `POST /api/products/[productId]/barcode` and the `set_product_barcode()`
  function, which writes `product_barcode_log` (who, when, old and new code,
  any override) in the same transaction.
- Migration `supabase/migrations/20261104_product_barcode_log.sql` creates the
  log and the function. It must be applied before "Scan to set barcode" works.
- Camera access needs HTTPS (production is fine). If the camera is blocked, the
  scanner offers "Type code instead".

## HR (claims, leave, MC, late penalties)

Staff = the Xocks team list (`xocks_team_members`). Staff never use an XCMS
account for HR; they use the **staff link `/hr`**.

- **Staff link `/hr`** (public path, skipped by `proxy.ts` like `/gang`):
  1. Shared link password → cookie `xcms_hr_gate` (30 days). Stored only as
     a scrypt hash in `hr_secrets` (server-only table: RLS on, no policies);
     changed from HR Admin → Report & settings (never in git). Missing = link locked.
  2. Pick your name + personal 4–6 digit PIN (`xocks_team_members.hr_pin_hash`)
     → cookie `xcms_hr_member` (12 h). First visit (or after an admin reset)
     the person creates their PIN. New people add name + PIN themselves.
  Cookies are HMAC-signed (key from `HR_PORTAL_SECRET`, else derived from
  `SUPABASE_SERVICE_ROLE_KEY`) and carry a fingerprint of the hash they were
  issued against: changing the link password or resetting a PIN signs those
  devices out. Wrong tries are capped via `rate_limit_attempts` (password 10
  per IP / 15 min; PIN 5 per person / 15 min). Code: `lib/hr/portal-session.ts`,
  pinned by `npx tsx scripts/test-hr-portal-session.ts`; routes `/api/hr-portal/*`.
  Staff only ever see and cancel their own records; the person always comes
  from the PIN session, never the request body.
- **HR Admin** `/admin/hr/manage` (**wayne@xocks.co only**: super_admin AND on the email list in `lib/hr/admins.ts`; checked in `lib/hr/access.ts` for every `/api/hr/*` route):
  approve/reject, mark claims paid, log late penalties (manual, default
  `hr_late_penalty_default`), PIN status + reset, per-person entitlements
  (`annual_leave_days`, `mc_days`), public holidays, link password, settings,
  and the **Activity log**.
- **Leave entitlements = Employment Act 1955 minimums from `join_date`**
  (`statutoryEntitlements` in `lib/hr/rules.ts`): annual 8/12/16 days and MC
  14/18/22 for under 2 / 2–5 / 5+ completed years. Annual leave is pro-rated by
  completed months in the joining year (s.60E(1A): ≥ half a day rounds up) and
  switches tier from the month the anniversary is reached; MC is not
  pro-rated and uses the highest tier reached that year. Staff give their join
  date when creating a PIN / adding their name, or once via a prompt; after
  that only the admin can change it (logged). `custom_entitlement` = use the
  typed `annual_leave_days` / `mc_days` instead — the API refuses numbers below
  the statutory minimum. No join date yet → typed numbers (defaults 8/14).
  Hospitalisation leave (s.60F, 60 days) is not modelled.
- **Replacement leave**: staff log rest-day / public-holiday work
  (`hr_rest_day_work`, the API decides the day kind from `hr_work_days` and
  holidays and refuses normal working days); each approved row earns 1 or 0.5
  days. Leave type `replacement` draws on it (all-time balance, no expiry),
  and the API refuses more than the remaining balance.
- **Lockdown (migration 20261107)**: no HR table has a read policy; RLS on
  and revoked from anon/authenticated, so ops_manager and store logins can't
  read HR data even directly. Every read/write goes through the API with the
  service role after the HR-admin or PIN check. PIN hashes live in
  `hr_member_pins`; HR settings (`hr_report_email`, `hr_late_penalty_default`,
  `hr_work_days`) and the link password hash live in `hr_secrets` — not in
  `public.settings`, which every login can read and ops can write.
- **Activity log** `hr_audit_log` (`lib/hr/audit.ts`): every link unlock,
  wrong password/PIN, sign-in, submission, cancel and admin change, with
  actor, IP and device. Admin actions done *to* a person carry
  `details.for_member_id`, so filtering by person shows both.
- **Rules** `lib/hr/rules.ts` (pure; `npx tsx scripts/test-hr-rules.ts`):
  leave days = working days (`hr_work_days`, ISO 1–7) minus
  `hr_public_holidays`; half day = 0.5. `days` is stored at submission, so
  adding a holiday later doesn't change old requests. Balances are per
  calendar year; emergency leave uses annual entitlement; approved + pending
  are both deducted from "left".
- **Files**: private bucket `hr-documents`, path `{member_id}/…`, uploaded via
  signed URL (`/api/hr-portal/upload-url`), streamed by
  `/api/hr-portal/requests/[kind]/[id]/file` (own files) and
  `/api/hr/requests/[kind]/[id]/file` (admin).
- **Monthly report**: `.github/workflows/hr-report.yml` → `/api/cron/hr-report`
  on the 1st at 10:00 MYT for the previous month: HTML summary + Excel
  (Summary, Claims, Leave & MC, Penalties) to `hr_report_email`. HR Admin →
  Report & settings has Download Excel and "Email it now".
- **Google Drive copies** (`lib/hr/drive.ts`): on approval, the receipt / MC
  slip is also uploaded to `Xocks HR Receipts / YYYY-MM / Name /` and
  `drive_url` saved on the row (shown as "Drive" links and in the Excel). The
  Supabase copy stays the source of truth; a failed Drive copy never blocks the
  approval — "Copy N waiting files now" (HR Admin → Report & settings) retries.
  Setup: Vercel env `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET`
  (OAuth Web client, redirect URI `https://consignmentportal.vercel.app/api/hr/drive/callback`,
  consent screen **published to Production** or Google expires the token in 7 days),
  then "Connect Google Drive". Scope `drive.file` = only files the app made.
  Google's Allow screen has a tickbox per permission: if the Drive box is left
  unticked the callback refuses the connection (`drive-box-not-ticked`).
  "Test" (next to Disconnect) writes a note into the root folder to prove the
  connection works end to end.
  Refresh token, account email and root folder id live in `hr_secrets`.
  **Status (2 Nov 2026): set up and connected** — Google Cloud project
  `xocks-hr` under waynelww2000@gmail.com (consent screen "Xocks HR", In
  production, client "XCMS"), folder My Drive / Xocks HR Receipts.
- Migrations: `supabase/migrations/20261102_hr_module.sql`, then
  `20261105_hr_drive_secrets.sql` (hr_secrets, moves the link password hash
  out of `settings`, Drive columns), then `20261106_hr_join_date_replacement.sql`
  (join_date, custom_entitlement, hr_rest_day_work, leave type replacement).

## Google Drive copies (delivery orders and invoices)

Every delivery order (DO) and monthly commission invoice is copied to the XCMS
Shared Drive, so the files can be found and opened without XCMS.

**What is saved**
- **Delivery orders: once received.** A DO gets a Drive copy when its status is
  `acknowledged` (received), whether or not the store has signed it. If a signed copy
  exists, that signed PDF is uploaded exactly as the store signed it; otherwise the
  normal DO PDF is uploaded. When the store signs a DO that is already in Drive, it is
  re-queued and the same Drive file is replaced with the signed copy. Drafts, confirmed,
  dispatched and delivered DOs are not uploaded.
- **Monthly invoices (`XCSM-###`).** The same PDF the store sees: the stored copy if
  one exists, otherwise generated from the data now.
- **Not saved:** daily sales reports, any store flagged as a test account, and any
  store that is not `active` (for example inactive or closed).
- There is no "packed" status in XCMS. A DO is queued when it is received
  (acknowledged) and again when it is signed.

**Folder layout** (inside the XCMS folder, `GOOGLE_DRIVE_FOLDER_ID`):

```
XCMS/<store_code> <store_name>/Delivery Orders/<DO number>.pdf      e.g. DO-2026-0007.pdf
XCMS/<store_code> <store_name>/Invoices/<invoice no> (<Mon YYYY>).pdf   e.g. XCSM-121 (Oct 2026).pdf
```

The invoice month is the month the invoice covers (the October invoice is made on
1 November).

**How it works**
- Saving a DO or invoice writes a `pending` row to `drive_uploads`. If that write
  fails, the record is still saved and the error is logged (`[drive-queue]`). Use the
  backfill, or the "queue" link on the record.
- **Uploaded right away.** When the row is queued by a store receiving (acknowledging)
  or signing a DO, a restock being received (`/api/restock/[requestId]/receive`), an
  admin edit that leaves a DO acknowledged, a new store's initial DO (created
  acknowledged), by an invoice being generated (Commissions → generate) or created
  on view (`/api/commissions/ensure`), or by an admin retry / queue
  (`/api/drive/requeue`), that row is uploaded just after the response is sent
  (Next.js `after()`, `lib/drive/now.ts`). The user never waits for Google. It uses
  the same upload code as the worker, including "only mark done if not re-queued".
  Any error there is only logged (`[drive-now]`): the row stays `pending` with no
  attempt counted, and the scheduled worker retries it.
- **Monthly invoices:** after the 1st-of-month invoice cron queues its invoices, it
  runs the worker in the same invocation with what is left of the 40-second budget.
  Invoices it does not reach stay pending for the scheduled worker.
- Other places that queue (restock approve/dispatch, the AI chat, the backfill)
  still wait for the scheduled worker.
- **Clean-up runs first in every worker run.** Any `delivery_order` copy whose DO is
  no longer `acknowledged` (or no longer exists) is moved to the Drive trash and its
  queue row deleted. A failed trash keeps the row for the next run.
- **Backup schedule:** `drive-uploads.yml` calls `POST /api/cron/drive-uploads`
  (scheduled every 15 minutes, but GitHub often runs it only every few hours). It
  picks up anything still pending: failed immediate uploads, retries, and rows
  queued elsewhere. Keep it. The worker takes the oldest-queued rows first and stops
  starting new ones after 40 seconds, so it finishes inside Vercel's 60-second limit.
- A re-queued DO **replaces the same Drive file**; it never makes a second copy. The
  file id is kept in `drive_uploads.drive_file_id`.
- **Retries:** a failure adds 1 to `attempts` and stores `last_error`. The row is
  retried on the next run. After 5 failures it is marked `failed` and waits for an
  admin to press retry.

**Where to see it**
- DO details modal, the store page's delivery orders, and the store page's and the
  Commissions page's invoice rows show one of: **Open in Drive**, **Drive: pending**,
  **Drive: failed — retry**, or **Not in Drive — queue**.
- Settings → General → **Google Drive copies** shows the pending / done / failed
  counts and the last five failures with their messages.

**Retry a failed copy**
1. Settings → General → Google Drive copies: read the failure message.
2. Open the DO or invoice and press **retry** (or **queue** if it was never queued).
   It uploads within a few seconds (refresh to see **Open in Drive**). If it still
   shows pending, the immediate upload failed; check Vercel logs for `[drive-now]`.
   The scheduled worker will retry it.
3. To queue everything again, a super admin or ops manager presses **Queue Drive backfill**.

**Backfill.** Settings → Google Drive copies → **Queue Drive backfill** (super admin
or ops manager) queues every **acknowledged** DO and every invoice created on or after
**1 Nov 2026 (MYT)** for **active, non-test** stores that is not already done. Nothing before November is touched. It is safe to press twice.

**Setup (already done, do not change)**
- Vercel env: `GOOGLE_SERVICE_ACCOUNT_JSON` (full key JSON) and `GOOGLE_DRIVE_FOLDER_ID`
  (the XCMS folder inside the Shared Drive). Never print or paste either value.
- The service account is a Content manager on the Shared Drive. It has no My Drive
  storage, so every Drive call sends `supportsAllDrives=true`.
- Code: `lib/google/drive.ts` (service-account sign-in and upload),
  `lib/drive/layout.ts` (names, pinned by `npx tsx scripts/test-drive-layout.ts`),
  `lib/drive/queue.ts`, `lib/drive/render.ts`, `lib/drive/worker.ts`,
  `lib/drive/now.ts` (immediate upload after the response).
- Migration: `supabase/migrations/20261106_drive_uploads.sql` (the `drive_uploads`
  table, admin-only read). It must be applied before the worker or the status
  columns work.

**Common failures**

| Message in Settings | Usual cause |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON is not set` / `…not valid JSON` | Vercel env var missing or pasted wrongly |
| `Google sign-in failed (invalid_grant)` | Key revoked or rotated; replace the Vercel value |
| `Drive folder search failed (HTTP 404)` | `GOOGLE_DRIVE_FOLDER_ID` is wrong, or the service account cannot see the folder |
| `Drive file upload failed (HTTP 403)` | Service account is not a Content manager on the Shared Drive |
| `Signed delivery order could not be read from storage` / `Stored invoice…` | The file in the `do-documents` or `commission-pdfs` bucket is missing; check Supabase Storage |

**Not handled (on purpose, for now)**
- If a store is flagged as a test account, or becomes inactive, after its records were queued, the worker
  still uploads them. Clear them with the Drive status or remove them in Drive.
- The HR receipts copy (`lib/hr/drive.ts`) is a separate OAuth connection and is not
  affected by this.

## First delivery order: store signature

A new store's first DO (`do_type` `initial`) is created already **Shop Received**
(acknowledged) with its stock added, in `app/api/stores/route.ts`. That stock step
is unchanged and the store does **not** receive the DO again. The store signs it
instead, which confirms the stock arrived.

- **Who must sign:** only initial DOs created **from 11 Nov 2026 (MYT)** on, that
  are acknowledged and have no `pdf_url`. Older stores' initial DOs are never
  flagged. The cutoff is `INITIAL_DO_SIGNATURE_FROM` and the rule is
  `needsStoreSignature`, both in `lib/delivery-orders/initial-signature.ts`
  (pinned by `npx tsx scripts/test-initial-do-signature.ts`).
- **Store app** (Delivery Orders): the DO sits under **Waiting for your
  signature** at the top, with Sign & Save. The store dashboard shows a yellow
  "Please sign your first delivery order" card that links there, until it is signed.
  After signing, the DO moves to Previously Received as normal.
- **Admin:** a **Not signed** badge on the DO in the Delivery Orders list and
  details, and in the store page's DO list.
- **Welcome message** (Add Store and Reset password & resend login) asks the owner
  to sign their first DO under Delivery Orders after logging in. Same text in both
  (`lib/stores/welcome-message.ts`, pinned by `npx tsx scripts/test-store-login.ts`).
- Signing uses the existing `POST /api/delivery-orders/[doId]/sign` route, unchanged.
  It re-queues the Drive copy, so the Drive file that was an unsigned DO PDF is
  replaced with the signed one (see Google Drive copies).
- Only the signature is new. Stock, DO numbers and the Drive upload on creation
  behave as before.

## Code map (the non-obvious parts)

- `lib/gang/` — tickets (`draw_month`, MAX+1), first-timer codes, phone
  normaliser (all phone matching flows through `normalizePhone`).
- `lib/shopify/` — GraphQL client (`gang-perk.ts` exports `shopifyGraphQL`),
  order lookup, discount creation, inventory sync.
- `lib/invoice-number.ts` — XCSM numbering.
- `lib/pdf/generate-statement.ts` — the commission invoice PDF (pdf-lib).
- `lib/pdf/generate-slip.ts` — 4 x 6 in packing slip for restock DOs
  ("Print slip" in the DO details modal → `/api/delivery-orders/[id]/pdf?slip&inline`,
  admins only, generated every time, nothing stored). One column → two
  columns → extra labels; pinned by `npx tsx scripts/test-packing-slip.ts`.
- `lib/events/target-calc.ts` — Event Target Calculator maths (single source
  of truth; pinned by `scripts/test-event-target-calc.ts`, run with
  `npx tsx`).
- `lib/delivery-orders/initial-signature.ts` — which initial DOs the store must sign
  (cutoff date + rule; used by the store app and the admin badges).
- `app/api/cron/` — endpoints driven by GitHub Actions, gated by
  `Authorization: Bearer CRON_SECRET` or `?key=CRON_SECRET`.
- Roles (`profiles.role`): `super_admin` (Wayne) > `ops_manager` (staff) >
  `store_owner`. Admin API routes check these server-side.

## Working on it with Claude Code

Clone the repo, drop `.env.local` in the root, and open Claude Code there —
`CLAUDE.md` / `AGENTS.md` / this handbook carry the context. Standard loop:
edit → `npx next build` + `npx tsc --noEmit` → commit (small, descriptive)
→ push to `main` → Vercel deploys → verify on the live site. For schema
changes, write the migration file AND paste it into the Supabase SQL editor
— nothing applies it automatically.
