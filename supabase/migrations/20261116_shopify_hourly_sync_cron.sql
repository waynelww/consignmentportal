-- Hourly Shopify inventory sync, run by Supabase pg_cron + pg_net.
--
-- Why: GitHub Actions schedules run hours late, and Vercel Hobby only allows
-- daily crons. This calls the same endpoint as the Refresh button and the
-- 03:30 MYT Vercel cron: /api/cron/sync-shopify-inventory.
--
-- Auth: each run inserts a single-use token into cron_tokens and sends it in
-- the x-cron-token header. The route accepts a token once, within 10 minutes,
-- and deletes it on use. No secret is stored in the database.
--
-- NOT APPLIED. Review, then apply with the Supabase connector to project
-- mhdyurnrmpjxsjbhbxrp after the operator's explicit OK. The hourly job does
-- nothing until this is applied.

-- product_sku_changes.source must allow 'hourly' (the sync route records it).
-- The original inline CHECK (migration 20261109) has Postgres's default name.
alter table public.product_sku_changes
  drop constraint if exists product_sku_changes_source_check;
alter table public.product_sku_changes
  add constraint product_sku_changes_source_check
  check (source in ('refresh', 'nightly', 'hourly'));

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

-- Single-use tokens for the cron route. Service role only.
create table if not exists public.cron_tokens (
  token uuid primary key default gen_random_uuid(),
  job text not null,
  created_at timestamptz default now()
);

alter table public.cron_tokens enable row level security;
-- No policies: nothing but the service role (and the owner) can read or write.
revoke all on public.cron_tokens from anon, authenticated;

create or replace function public.run_hourly_shopify_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  -- Drop tokens that were never used.
  delete from public.cron_tokens
  where created_at < now() - interval '10 minutes';

  insert into public.cron_tokens (job)
  values ('shopify-inventory')
  returning token into v_token;

  -- pg_net is async. The timeout is longer than the route's work (about 25s
  -- budget, 60s ceiling) so the response is captured in net._http_response.
  perform net.http_post(
    url := 'https://consignmentportal.vercel.app/api/cron/sync-shopify-inventory',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', v_token::text
    ),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function public.run_hourly_shopify_sync() from public, anon, authenticated;

-- Hourly, on the hour, UTC. Scheduling with an existing name replaces that job.
select cron.schedule(
  'xcms-shopify-sync-hourly',
  '0 * * * *',
  'select run_hourly_shopify_sync()'
);
