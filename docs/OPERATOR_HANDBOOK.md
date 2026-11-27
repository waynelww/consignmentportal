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
  (own event stock: add/remove, separate from Office) and the Event Target Calculator.
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
  the same numbers. An hourly run does too (see "Hourly Shopify inventory sync").
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

- **Event page (Add / Remove stock):** the same reader replaces the old "SKU, Quantity"
  bulk box. What it reads goes to a **Preview** first (edit pairs, skip lines; lines with
  no quantity must get pairs or be skipped), then **Add N SKUs to list** fills the add or
  remove list. It matches only products that can go to events: the Special Patches Series
  is left out (`isExcludedFromPos` in `lib/pos/catalog.ts`; the AI route takes
  `scope: 'event'`). For **Remove**, each line is capped at what is left in the event less
  what is already on the list, and the preview says so. Ledger reasons, Office and Shopify
  are unchanged. The close modal's "Bulk fill Returned" still takes "SKU, Quantity" only.
- **"SKU, Quantity" lines** (spreadsheet / CSV, comma or semicolon; tab already worked)
  read as that SKU and that many pairs: "A27, 6" = A27 x6. A header row ("SKU, Quantity")
  is skipped. A cut list ("Ankle 06, 15") still means A6 and A15. **Upload CSV / TXT**
  (event page only) loads a file into the box.

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
- **No Show (V codes, Plain Series - No Show Socks)** are sold to consignment and read like
  Ankle, Half and Crew: "V26 x5" is V26, 5 pairs. "No Show" (or "noshow") works as a cut
  header, and a colour written with "No Show" matches the V product.
- **Cuts:** a line with only Ankle, Half, Crew or No Show sets the cut for the lines below. A colour
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

## Hourly Shopify inventory sync (Supabase pg_cron)

- **What:** every hour on the hour (`0 * * * *`, UTC) the database calls
  `/api/cron/sync-shopify-inventory`, the same sync as the Refresh button and the
  03:30 MYT Vercel cron. It keeps the Office (HQ) stock, SKUs and photos fresh
  during the day. Why it runs from the database: GitHub Actions schedules run
  hours late, and Vercel Hobby only allows daily crons.
- **Pieces:** pg_cron job `xcms-shopify-sync-hourly` runs
  `select run_hourly_shopify_sync()`. That function inserts a single-use row in
  `cron_tokens` (job `shopify-inventory`) and POSTs the token in an
  `x-cron-token` header with pg_net. The route accepts a token once, within 10
  minutes, then deletes it. Migration: `supabase/migrations/20261116_shopify_hourly_sync_cron.sql`.
  It must be applied before the job does anything.
- **Secrets:** none for this job. Nothing is stored in the database or pg_cron.
  The token is a throwaway that expires in 10 minutes and is deleted on use.
  Shopify and service keys stay in the Vercel environment variables.
- **Check it:** run in the Supabase SQL editor.

  ```sql
  -- Did pg_cron fire it? Status, timing and any error for each run.
  select runid, status, return_message, start_time, end_time
  from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'xcms-shopify-sync-hourly')
  order by start_time desc
  limit 10;

  -- Did the HTTP call succeed? status_code 200 means the sync ran.
  select id, status_code, timed_out, error_msg, created
  from net._http_response
  order by created desc
  limit 10;
  ```

  `cron.job_run_details` only shows that the function ran. The HTTP status is in
  `net._http_response`, which keeps responses for a short time only. For the
  summary lines, check the Vercel function logs for `[cron sync-shopify-inventory]`.
- **Pause:** `select cron.unschedule('xcms-shopify-sync-hourly');`
  This stops only the hourly job. The 03:30 MYT Vercel cron and the Refresh button
  keep working. To resume, re-run the `cron.schedule(...)` line in the migration.
- **History:** hourly runs are recorded as source `hourly` in
  `product_sku_changes`. The 03:30 MYT Vercel run is `nightly` and the Refresh
  button is `refresh`. The source column allows all three values. The migration
  changes the CHECK constraint to allow `hourly`.

## Automation inventory (GitHub Actions + webhooks)

- Supabase pg_cron `xcms-shopify-sync-hourly` — hourly Shopify inventory sync (see "Hourly Shopify inventory sync"). Lives in the database, not GitHub.
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

## Store owner guided tour

An overlay tour for store owners in the store app (`/store/*`). It only adds
an overlay: pages keep their layout and behaviour. Apart from the tour mount
in `app/(store)/layout.tsx`, the only edits to store pages are `data-tour="..."`
attributes.

**Migration:** `supabase/migrations/20261116_store_owner_tour.sql`. Apply it
with `apply_migration` after operator OK, and **before** deploying the code
that inserts `tour_status` (Add Store), or the insert fails on the unknown column.

**Data (`profiles`):**
- `tour_status`: `new` | `offer` | `snoozed` | `declined` | `in_progress` | `completed`. Null = no tour (non-owners).
- `tour_step`: the stable step id (1–21), saved as the owner moves through the tour.
- `tour_lang`: `en` | `bm`, saved from the EN/BM switch.
- `tour_completed_at`: set on finish. A replay keeps the original date.
- Existing store owners were backfilled to `offer`. Add Store creates the profile as `new`.
- The browser role can update only the four `tour_*` columns (column grant). Its other profile
  writes (name, phone, role, store) go through the service-role API, as before.

**What shows, and when:**

| Status | On the next browser session in the store app |
|---|---|
| `new` | Welcome sheet (👋) → Start / Maybe later |
| `offer`, `snoozed` | Offer popup (✨) → Start / Maybe later / No thanks |
| `in_progress` | "Continue your tour?" at the saved step → Continue / Not now |
| `completed`, `declined` | Nothing. Replay from **Home → Start tour** |

- Maybe later → `snoozed`. No thanks → `declined`. Skip mid-tour → `in_progress` + `tour_step`. Finish → `completed` + `tour_completed_at`.
- "Next login" = the next time the browser session starts (sessionStorage). Within one session the prompt appears at most once.
- A popup that gets no answer stays `offer`, so it comes back next session until the owner answers.
- Replays from Home do not downgrade a `completed` status.

**Steps and copy:** `lib/tour/content.ts` (EN and BM). Step ids are stored in
`tour_step`, so **never renumber**. Add new steps at the end, or migrate the data.
Step 15 (first DO signature) is dropped unless the store has an initial DO that
still needs its signature (`needsStoreSignature`, `lib/delivery-orders/initial-signature.ts`).
Targets are CSS selectors tried in order: the first visible match wins, so a step
whose item is missing (empty cart, no history) falls back to the nearest section.
Bottom-nav tabs and the bell are found by their `href`, so they need no attribute.

**Logic:** `components/store/tour/StoreTour.tsx` (mounted in the store layout), with pure helpers in `lib/tour/logic.ts`.
`data-tour` attributes are on the Home, Sales, Inventory, Deliveries and Info sections.
The **Start tour** button is next to Tutorial Guide on Home (event `xcms:start-tour`).

**Admin:** store Overview → **Owner tour** card (`components/admin/StoreTourStatus.tsx`).
It is read-only: Not started / Snoozed / Declined / In progress at step N / Completed on <date>.

**Don't:** add `data-tour` to elements that would change layout or styling, or move
the help page (`/store/help`), which stays as it is.

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
  invoice, from Settings → Company Info; see "Commission invoice layout" below)
  and upload receipts; admin reviews in Payments.
- **Gang draw** — tickets are scoped to the current Malaysia-time month
  (`draw_month`); winners drawn manually, announced on WhatsApp end of month.

## Commission invoice layout and bank details

Two invoice layouts exist. The period decides which one is used
(`usesLegacyInvoiceLayout` in `lib/pdf/generate-statement.ts`):

- **Period October 2026 or earlier: legacy layout.** Code:
  `lib/pdf/generate-statement-legacy.ts`, a verbatim copy of the layout on `main`
  before the redesign. Figures, wording, the payment reminder and the fixed bank
  line are exactly as before. Do not edit that file.
- **Period November 2026 onward: new plain A4 layout.** Code: the invoice builder in
  `lib/pdf/generate-statement.ts`. Both the store download route
  (`app/api/commissions/[periodId]/pdf/route.ts`) and the Drive renderer
  (`lib/drive/render.ts`) use it, so they print the same thing.

New layout:

- **Page:** company name and address/contact (top left) · title · STORE
  INFORMATION (left: store, PIC, address, wrapped) and the details block (right) ·
  product table with the header repeated on extra pages · dashed rule and TOTAL ·
  bank details and payment reference (bottom left) · total sales revenue, store
  commission and amount to transfer (bottom right) · footer · "Page X of Y".
- **Right-hand block:** INVOICE NO, STATEMENT PERIOD, GENERATED, STATUS (PAID in
  green), PAYMENT REFERENCE (the period's stored `payment_reference`, when set) and
  PAID ON (when a paid date is set). The bottom-left payment reference is the
  `XCSM-### / STORE-CODE – Month YYYY` string, as on the legacy layout.
- **No payment reminder.** The transfer-within-N-days line and the 10% late-payment
  line are removed. `paymentTermsDays` is still passed but not printed.
- **Figures are unchanged.** Commission rows are the same per-product, per-staff sums
  as before. No rounding adjustment is applied, so rows can differ from the total by
  a few sen, as they always did. The TOTAL row and the amount to transfer are the
  stored period values.
- **Address:** the store address now wraps in full. The legacy layout cut it at
  60 characters. This is the only change the layout brief asked for in the content.
- **Company Info** (Settings → Company Info) feeds the top-left block:
  `company_name`, `company_reg_number`, `company_address`, `company_contact`.
  The registration number prints in brackets after the company name
  (e.g. `WAYNE GROUP HOLDING SDN BHD (1543772-U)`) and is left out when empty.
  There are no separate phone or email fields, so those do not print.
- **Bank details** are editable in Settings → Company Info:
  `company_bank_name`, `company_bank_account_name`, `company_bank_account_no`.
  Settings opens with the current values filled in; the first Save stores them.
  No migration is needed. An empty field falls back to its current value
  (CIMB Bank / Wayne Group Holding Sdn Bhd / 8605806682) in `lib/pdf/bank-details.ts`.
  The legacy layout keeps its fixed bank line and does not read these settings.

Stored PDFs and Drive are not changed by this:

- The download route serves a stored PDF (`pdf_url`) as it is. It generates and
  stores a PDF only when `pdf_url` is empty. Nothing regenerates a stored invoice.
- The Drive renderer uses the stored PDF when one exists. Otherwise it generates the
  PDF at upload time. Saving settings does not queue anything. Drive uploads are queued
  only by the existing actions (invoice generation, `commissions/ensure`, retry and
  backfill). The backfill covers invoices created from 1 Nov 2026 only, so October 2026
  and earlier invoices are never re-queued by it.

Changing the layout: run `npx tsc --noEmit -p tsconfig.json`, then check a generated
invoice on the live site. Never change the legacy file.

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
- PDF: its own layout in `lib/pdf/generate-statement.ts` (daily mode, unchanged
  when the monthly invoice was redesigned): titled "Daily Sales Report", with the sales date in place of the
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

## Event POS and Event Targets (booth events)

Booth events sell on the **Event POS** (`/pos/[eventId]`), a phone-only page
that replaces Shopify POS at events. It sells **only from the event's own XCMS
stock location** (`events.stock_location_id`, filled by "Add stock to event"),
never from Shopify stock. Migration: `supabase/migrations/20261127_event_pos.sql`.

- **Event stock is separate from Office stock.** Office in XCMS is overwritten
  hourly by the Shopify HQ sync, so events never move stock to or from Office.
  Ledger rows (`stock_transfers`) for an event location:
  - **Add stock to event** (`POST /api/events/[id]/checkout`; list filled by search or the
    stock list reader, see "Stock list reader"): from = NULL,
    to = event, reason `Event stock added: <event>`. Office is not checked.
  - **Remove stock from event** (`POST /api/events/[id]/return`, corrections):
    from = event, to = NULL, reason `Event stock removed: <event>`; never below 0.
  - **Close**: sold above POS → `Sold at event (outside POS): …`; then
    everything left in the event location is zeroed with
    `Event closed — returned: <event>` (to = NULL). The admin's Returned
    figures are kept per SKU in `event_close_counts` (expected left, typed
    returned, variance, closed_by, closed_at; migration
    `20261127_event_close_counts.sql`), saved before any stock moves — if the
    table is missing the close is refused with nothing changed. The closed
    event page shows "Counted back" and Variance from it.
    Returned stock is **not** added to Office — update Office in Shopify.
  - Add/remove return `done` (product ids applied) so a partly failed batch
    is never applied twice on retry; close checks all quantities before writing.
  - Per-SKU Added / Sold (POS) / Removed-Returned / Left come only from the
    event location and its ledger (`lib/events/stock-ledger.ts`, which also
    reads old `Event checkout:` / `Partial return:` / `Event return:` rows).

- **Targets live on the event.** The Event Target Calculator is the "Targets"
  section of each event page (`components/events/target-calculator.tsx`, maths
  unchanged in `lib/events/target-calc.ts`), saved with `event_targets.event_id`
  (one per event); name + start date come from the event. Day row N = start
  date + N−1 days (that's how a sale's date finds its tiers). Global settings
  are the **Target settings** button on the Events list (admin and ops manager),
  including `profit_unlock_amount` (default RM1,000). `/admin/events/targets`
  redirects to `/admin/events`; old unlinked targets show under "Unlinked
  targets" with "Link to event".
- **Part-timers** (`pos_staff`, one per person, reused across events;
  `event_staff` links them to an event, `hidden` = off the POS but sales kept).
  PIN hashes are in `pos_staff_pins` (server-only like `hr_member_pins`). A
  blank PIN is generated and shown once. Remove only with no sales on the event.
- **POS link**: public path (skipped by `proxy.ts`), all data via
  `/api/pos/[eventId]/*`, which checks the signed cookie `xcms_pos_<event>`
  (`lib/pos/session.ts`; event + person + PIN fingerprint, 16 h). Works only
  while the event is `active`. 5 wrong PINs → that person locked 5 minutes
  (`rate_limit_attempts`, keyed by person, not IP). Barcode scan reuses the
  ZXing scanner (works on iPhone Safari too).
- **Catalogue rules** (`lib/pos/catalog.ts`): Special Patches Series never shows;
  add-ons = patches, tote bags, boxes (not pairs); "Design" = category `design`;
  "FREE 6 / 10 Patches" are POS items at RM0 recorded on the RM4 patch product
  (SKU `Patches`) as 6 / 10 patches.
- **Patches have no event stock** (too many to count). "(RM4) Per Patches",
  "FREE 6 Patches" and "FREE 10 Patches" are always in the POS Add-ons tab for
  every active event, whatever the event stock: no "N left", never greyed out,
  no stock check, and no stock taken from any location. Socks keep the strict
  event-stock check. Every patch line is still written to `pos_sale_items`
  (RM4 = qty sold; FREE 6 / 10 = `stock_qty` 6 / 10 at RM0). "Free 1 Set
  Patch" (RM8 off = 2 RM4 patches) works off the RM4 patch item as before.
  Rule: `isPatchSku` in `lib/pos/catalog.ts`; SQL: migration
  `20261128_event_pos_patches_no_stock.sql` (`pos_record_sale` /
  `pos_void_sale` skip the stock check, `location_stock` and `stock_transfers`
  for patch lines). **Apply that migration before deploying this code**, or
  patch sales fail with "Not enough stock for Patches".
- Patches are never event stock: not in the Add / Remove stock reader or search
  (the API refuses them too), not in the event's stock table, not in the close
  Returned counts, and close leaves any old patch stock row untouched.
- **Patches given** card on the event page: RM4 patches sold, free patches
  (FREE 6 / 10) and the total, per day and for the whole event, from POS sales
  (voided excluded), to plan how many to bring next time (`lib/pos/patches.ts`).
- **Discounts** (`pos_discounts`, `lib/pos/discounts.ts`): rules, not RM amounts;
  one per sale; cheapest pairs go free; % applies after free pairs; a discount
  that stops qualifying is dropped with a note. `event_id` NULL = global (seeded
  list). Pinned by `npx tsx scripts/test-pos.ts`.
- **Sales** are written only by the SQL function `pos_record_sale` (one
  transaction, event row locked): idempotency key, stock check at the event
  location, `sale_no` per event, `pos_sales` + `pos_sale_items`, stock out with
  ledger reason `Event POS sale: <event> #<n>`. Prices and discount are
  recalculated by the API first. **Void** (admin, event page) = `pos_void_sale`:
  stock back (`Event POS void: …`), audit row in `pos_sale_audit`.
- **Bonus**: event profit = POS sales (not voided, after discounts) − the
  target's `fixed_cost` (sock cost not included). Until profit reaches
  `profit_unlock_amount`, sales don't count; the crossing sale counts only the
  part above the line. Stored per sale in `bonus_eligible_amount` (in sale
  order); recalculated by `pos_recalc_bonus` after a void, a target save/delete
  or a settings change. Tiers: that day's per-person tier 1/2/3, highest hit
  only, bonus from settings. No target saved = bonuses off. **Part-timers never
  see event profit or unlock status** — the POS API doesn't return them.
- **Closing an event that used the POS**: Sold is pre-filled from POS sales
  (already out of event stock); only a number above it is deducted as
  "Sold at event (outside POS)".

## Payment receipts (store upload)

Stores pay Xocks their transfer amount (`xocks_revenue`) for each monthly invoice and
upload the proof of payment here. An admin confirms or rejects it in Payments.

**Store side** (`components/store/PaymentReceiptCard.tsx`, shown on the Commissions
page and the store profile's Past Invoices card; English only, not in the tour's
language switch)
- Unpaid invoices with an amount to transfer get an **Upload receipt** button in the
  invoice's header row, left of the **Invoice** button (outline style). It becomes
  **Upload again** after a rejection.
- The picker offers camera, photos or files. Accepted: JPG, PNG, WEBP, HEIC or PDF.
  Photos over 4 MB are resized in the browser (up to 2400 px, JPEG). A PDF over 4 MB
  is refused with a message; the store must send a smaller file.
- Upload goes to `POST /api/payments/receipts` (`period_id` + `file`). Re-uploading
  replaces the receipt for that invoice; the row id stays the same.
- Card states: **Receipt sent · Xocks will check it shortly** (with the file name);
  **Receipt rejected** with the admin's note; **Payment receipt verified by Xocks**
  once paid. A green note always tells the store to tap Upload receipt, or to send it
  to the WhatsApp group.
- Helper: `lib/receipts/prepare-file.ts` (type check, 4 MB check, image resize).
  The server enforces the same limits.

**Admin side**: Payments → the **Receipt** column shows **View** (the file) and the
Drive status under it: **Open in Drive**, **Drive: pending**, **Drive: failed — retry**,
or **Not in Drive — queue**.

**Google Drive copy:** every upload or replacement is copied to Drive right away (see
"Google Drive copies"). Test and inactive stores are not copied.

**Status and history:** the receipt row (`payment_receipts`) keeps `status`
(`submitted` / `confirmed` / `rejected`), `admin_notes` and `reviewed_by`. Confirming
marks the invoice paid. Nothing is deleted by a re-upload: the file in storage (bucket
`payment-receipts`) is kept under a new path, and the Drive copy is replaced.

**Migration:** `supabase/migrations/20261116_drive_payment_receipts.sql` must be applied
before receipt copies can be queued. Until then the upload still works and the copy is
logged as `[drive-queue]` and not queued.

## Google Drive copies (delivery orders, invoices and payment receipts)

Every delivery order (DO), monthly commission invoice and store payment receipt is copied
to the XCMS Shared Drive, so the files can be found and opened without XCMS.

**What is saved**
- **Delivery orders: once received.** A DO gets a Drive copy when its status is
  `acknowledged` (received), whether or not the store has signed it. If a signed copy
  exists, that signed PDF is uploaded exactly as the store signed it; otherwise the
  normal DO PDF is uploaded. When the store signs a DO that is already in Drive, it is
  re-queued and the same Drive file is replaced with the signed copy. Drafts, confirmed,
  dispatched and delivered DOs are not uploaded.
- **Monthly invoices (`XCSM-###`).** The same PDF the store sees: the stored copy if
  one exists, otherwise generated from the data now.
- **Payment receipts.** The file the store uploaded, unchanged, with its own type
  (JPG, PNG, WEBP, HEIC or PDF). The record is the receipt (`payment_receipts.id`), so
  each invoice has one Drive file that a re-upload replaces. See "Payment receipts".
- **Not saved:** daily sales reports, any store flagged as a test account, and any
  store that is not `active` (for example inactive or closed).
- There is no "packed" status in XCMS. A DO is queued when it is received
  (acknowledged) and again when it is signed.

**Folder layout** (inside the XCMS folder, `GOOGLE_DRIVE_FOLDER_ID`):

```
XCMS/<store_code> <store_name>/Delivery Orders/<store_name> – <Month YYYY> (<DO number>).pdf
                                  e.g. Niqez Store Enterprise – November 2026 (DO-2026-0062).pdf
XCMS/<store_code> <store_name>/Invoices/<store_name> – <Month YYYY>.pdf
                                  e.g. HYPRGROUND HOLDING SDN BHD – October 2026.pdf
XCMS/<store_code> <store_name>/Payment Receipts/<store_name> – <Month YYYY>.<ext>
                                  e.g. HYPRGROUND HOLDING SDN BHD – October 2026.jpg
```

**One naming style for every file**, with an en dash (–):
- **Invoice:** Month YYYY is the month the invoice covers (the October invoice is made on
  1 November but is named October 2026).
- **Delivery order:** Month YYYY is the month the DO was created, in Malaysia time (a DO
  created 31 Oct 2026 at 8.30 pm is November 2026). The DO number is in brackets, so
  several DOs for one store in one month have different names.
- **Payment receipt:** the invoice's month, with the file's own extension.
- Characters Windows and Drive do not allow (`/ \ : * ? " < > |`) are removed from every
  file name. Folder names are unchanged.
- Existing Drive files were renamed to these names with the one-off step below. Files
  uploaded after that get the new name directly.

**How it works**
- Saving a DO or invoice writes a `pending` row to `drive_uploads`. If that write
  fails, the record is still saved and the error is logged (`[drive-queue]`). Use the
  backfill, or the "queue" link on the record.
- **Uploaded right away.** When the row is queued by a store receiving (acknowledging)
  or signing a DO, a restock being received (`/api/restock/[requestId]/receive`), an
  admin edit that leaves a DO acknowledged, a new store's initial DO (created
  acknowledged), by an invoice being generated (Commissions → generate) or created
  on view (`/api/commissions/ensure`), or by an admin retry / queue
  (`/api/drive/requeue`), or a store uploading or replacing a payment receipt
  (`/api/payments/receipts`), that row is uploaded just after the response is sent
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
- Admin Payments page: the same status under each receipt's **View** link.
- Settings → General → **Google Drive copies** shows the pending / done / failed
  counts and the last five failures with their messages.

**Retry a failed copy**
1. Settings → General → Google Drive copies: read the failure message.
2. Open the DO or invoice and press **retry** (or **queue** if it was never queued).
   It uploads within a few seconds (refresh to see **Open in Drive**). If it still
   shows pending, the immediate upload failed; check Vercel logs for `[drive-now]`.
   The scheduled worker will retry it.
3. To queue everything again, a super admin or ops manager presses **Queue Drive backfill**.

**Rename existing files (one-off).** Files uploaded before the naming change keep their old
names until this is run. Settings → General → Google Drive copies → **Rename Drive files to
new names** (super admin or ops manager):
1. Confirm. The button works through every done Drive copy in batches, renaming each file
   in place by its stored Drive file id. Only the name is changed: nothing is re-uploaded
   and file contents are not read. It can be pressed again if the connection drops.
2. The result shows how many were checked, **renamed**, **missing in Drive** (the file was
   deleted in Drive, so there is nothing to rename) and **failed**, with the first failures
   and their messages. A failed file keeps its old name; press the button again after fixing
   the cause (usually the Drive permissions, see the table under "Common failures").
- API: `POST /api/drive/rename-files` with `{ after }` from the previous response, until
  `finished` is true. Code: `lib/drive/rename.ts`.

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
  `lib/drive/queue.ts`, `lib/drive/render.ts` (`renderPaymentReceipt` for receipts),
  `lib/drive/worker.ts`, `lib/drive/now.ts` (immediate upload after the response),
  `lib/drive/rename.ts` (one-off rename of existing files).
- Migration: `supabase/migrations/20261106_drive_uploads.sql` (the `drive_uploads`
  table, admin-only read). It must be applied before the worker or the status
  columns work. Payment receipts also need `20261116_drive_payment_receipts.sql`
  (widens the `kind` check).
- Receipts are not part of the backfill. Use the **queue** link on each receipt in
  Payments to copy an older one.

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
- `lib/pdf/generate-statement.ts` — the commission invoice PDF (pdf-lib) and
  the daily sales report PDF (`daily` mode). See "Commission invoice layout".
- `lib/pdf/generate-statement-legacy.ts` — the invoice layout for periods up to
  October 2026 (verbatim copy of the pre-redesign generator; do not edit).
- `lib/pdf/bank-details.ts` — invoice bank settings keys and fallback values.
- `lib/pdf/generate-slip.ts` — 4 x 6 in packing slip for restock and initial DOs
  ("Print slip" in the DO details modal → `/api/delivery-orders/[id]/pdf?slip&inline`,
  admins only, generated every time, nothing stored). One column → two
  columns → extra labels; pinned by `npx tsx scripts/test-packing-slip.ts`.
- `lib/pos/` — Event POS: catalogue, discount and bonus rules (pure), session,
  loaders; SQL in `20261127_event_pos.sql` (see "Event POS and Event Targets").
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
