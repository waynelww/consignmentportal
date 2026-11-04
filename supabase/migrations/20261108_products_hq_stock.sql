-- Live "Office (HQ)" stock from Shopify (lib/shopify/sync-inventory.ts).
-- Only the Office (HQ) location's "available" quantity is stored here.
-- The older shopify_inventory_qty / shopify_inventory_synced_at columns are
-- kept untouched for now (they hold the old all-location total).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS hq_available_qty INTEGER,
  ADD COLUMN IF NOT EXISTS hq_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN public.products.hq_available_qty IS 'Shopify Office (HQ) location, available quantity, matched by SKU';
COMMENT ON COLUMN public.products.hq_synced_at IS 'When hq_available_qty was last refreshed from Shopify';
