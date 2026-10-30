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
  4-month quantity from `wayne-calc.ts`, split across carried codes by sales
  share (minimum 1 pair per code, so the total can be a pair or two over).
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
  and the admin CSV export (`/api/admin/export`: sales, commissions, stores).
- Commission invoices are **not** excluded: test stores get the monthly
  invoice like any other store, so they can be tested end to end.
- The rule lives in one place: `lib/stores/test-accounts.ts`
  (`loadTestStoreIds` + `isTestStore`). Every report filters with it; do not
  add a second rule.

## Automation inventory (GitHub Actions + webhooks)

- `monthly-invoices.yml` — 1st + 2nd of month, generates commission invoices.
- `monthly-report.yml` — 1st of month 09:30 MYT, emails last month's report
  (PDF + Excel) to `monthly_report_email`. See "Monthly report" below.
- `low-stock-summary.yml` — daily 09:00 MYT low-stock email (see Low stock).
- `daily-sales-report.yml` — daily 22:00 MYT internal sales PDFs, batched (see Daily sales report).
- `nightly-backup.yml` — nightly database backup.
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
is emailed as a PDF of that day's sales. Recipients are Xocks team addresses
(`stores.daily_report_recipients`), never the store. The switch defaults to off
and can't be on without at least one recipient (also enforced by a DB check).

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
  invoice number. No XCSM number, no status and no bank-transfer details.
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
  `supabase/migrations/20261101_daily_sales_report.sql` must be applied before
  the first run.
- Store users can read `daily_report_recipients` through their own store row
  (the stores table has no column-level hiding). Keep the recipients to team
  addresses.

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
