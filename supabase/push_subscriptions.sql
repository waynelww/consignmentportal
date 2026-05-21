-- Run this in Supabase SQL Editor
-- Creates the push_subscriptions table for Web Push PWA notifications

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  -- One endpoint per user (upsert on conflict)
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_store_id ON push_subscriptions(store_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id  ON push_subscriptions(user_id);

-- Also add payment_terms_days if not done yet (from previous migration)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER DEFAULT 7;
