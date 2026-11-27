-- Performance dashboard Phase 2: daily Meta ad insights.
-- One row per (date, ad). The sync re-fetches a trailing 28-day window every
-- run because Meta restates attributed conversions for up to 28 days, so
-- upserts (not inserts) keep history honest.

CREATE TABLE IF NOT EXISTS meta_ad_insights (
  date_myt date NOT NULL,          -- ad-account timezone date (account is Asia/Kuala_Lumpur)
  ad_id text NOT NULL,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  spend numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  purchases integer NOT NULL DEFAULT 0,       -- omni_purchase actions
  purchase_value numeric NOT NULL DEFAULT 0,  -- omni_purchase action_values (MYR)
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date_myt, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ad_insights_date ON meta_ad_insights (date_myt);
CREATE INDEX IF NOT EXISTS idx_meta_ad_insights_campaign ON meta_ad_insights (campaign_id, date_myt);

-- Service-role-only access (same pattern as shopify_orders): RLS on, no policies.
ALTER TABLE meta_ad_insights ENABLE ROW LEVEL SECURITY;
