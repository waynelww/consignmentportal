-- Shopify warehouse inventory snapshot on each product row.
-- shopify_inventory_qty: total pairs available across all Shopify locations
-- shopify_inventory_synced_at: timestamp of the last successful sync

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS shopify_inventory_qty INTEGER,
  ADD COLUMN IF NOT EXISTS shopify_inventory_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_products_shopify_inventory_qty
  ON public.products(shopify_inventory_qty)
  WHERE shopify_inventory_qty IS NOT NULL;
