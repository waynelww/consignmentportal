-- Performance dashboard data layer: synced Shopify orders + Shopee/TikTok
-- uploads. Service-role access only (RLS enabled, no policies — same pattern
-- as 20260924_event_targets.sql); all reads go through admin-checked API
-- routes. Paste into the Supabase SQL editor by hand.

-- ── Shopify orders (synced incrementally by updated_at cursor) ───────────────
CREATE TABLE IF NOT EXISTS public.shopify_orders (
  id TEXT PRIMARY KEY,                    -- Shopify GID: gid://shopify/Order/123
  name TEXT NOT NULL,                     -- "#1043"
  processed_at TIMESTAMPTZ NOT NULL,
  processed_date_myt DATE NOT NULL,       -- computed in sync code (UTC+8, no DST)
  updated_at_shopify TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  financial_status TEXT,
  source_name TEXT,                       -- 'web' | 'pos' | 'shopify_draft_order' | ...
  location_id TEXT,                       -- physicalLocation gid (POS orders)
  location_name TEXT,
  currency TEXT NOT NULL DEFAULT 'MYR',
  gross_sales NUMERIC(12,2) NOT NULL DEFAULT 0,       -- line items before discounts
  discounts NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,  -- net sales: post-discount, post-refund, excl ship/tax
  shipping NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_refunded NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_total NUMERIC(12,2) NOT NULL DEFAULT 0,     -- customer-paid incl ship/tax, after refunds
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_date ON public.shopify_orders(processed_date_myt);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_source_date ON public.shopify_orders(source_name, processed_date_myt);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_location ON public.shopify_orders(location_id, processed_date_myt);

CREATE TABLE IF NOT EXISTS public.shopify_order_items (
  order_id TEXT NOT NULL REFERENCES public.shopify_orders(id) ON DELETE CASCADE,
  line_item_id TEXT NOT NULL,             -- LineItem gid
  sku TEXT,                               -- trimmed + UPPERCASED to match products.sku
  title TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,          -- as ordered
  current_quantity INTEGER NOT NULL DEFAULT 0,  -- after refunds/removals — aggregate on this
  line_revenue NUMERIC(12,2) NOT NULL DEFAULT 0, -- discountedTotal
  PRIMARY KEY (order_id, line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_shopify_order_items_sku ON public.shopify_order_items(sku);

-- ── Shopee / TikTok Shop sales (file upload; one row per order line) ─────────
CREATE TABLE IF NOT EXISTS public.marketplace_upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('shopee','tiktok')),
  filename TEXT,
  rows_ingested INTEGER NOT NULL DEFAULT 0,
  date_min DATE,
  date_max DATE,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketplace_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('shopee','tiktok')),
  order_id TEXT NOT NULL,
  order_date_myt DATE NOT NULL,
  sku TEXT,                               -- normalized UPPER; exports sometimes lack it
  product_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  line_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,      -- customer-paid for the line
  settlement_amount NUMERIC(12,2),                    -- payout after platform fees, when the export has it
  status TEXT,                                        -- raw order status from the export
  upload_batch_id UUID NOT NULL REFERENCES public.marketplace_upload_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_sales_date ON public.marketplace_sales(platform, order_date_myt);
-- Re-uploads replace by (platform, order_id) set — this index guards accidental doubles
CREATE INDEX IF NOT EXISTS idx_marketplace_sales_order ON public.marketplace_sales(platform, order_id);

ALTER TABLE public.shopify_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_upload_batches ENABLE ROW LEVEL SECURITY;
