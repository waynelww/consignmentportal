-- Test accounts: stores used for staff training and system testing.
-- A test store works normally in the store app but is excluded from every
-- report, KPI, alert email, restock calculation and commission invoice run
-- (see lib/stores/test-accounts.ts).
--
-- Additive only: no rows are deleted. Apply after the code is deployed or
-- before it: the new code reads stores.is_test, so the column must exist
-- before the release goes live.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

-- Wayne Store (AGK-001) and Vaernand store (STR-009).
UPDATE public.stores
SET is_test = true
WHERE store_code IN ('AGK-001', 'STR-009');
