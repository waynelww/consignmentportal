-- Xocks Gang purchase history: captures what was actually bought (product +
-- quantity) per order number, sourced from the Shopee/TikTok exports
-- uploaded at /admin/gang. Lets a returning member's phone number surface
-- their lifetime pairs bought and top products, without ever storing the
-- raw export file itself (only these extracted rows).

CREATE TABLE IF NOT EXISTS public.gang_order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gang_order_items_order_number ON public.gang_order_items(order_number);

ALTER TABLE public.gang_order_items ENABLE ROW LEVEL SECURITY;
-- No policies = service-role only, same as the rest of the Gang feature.
