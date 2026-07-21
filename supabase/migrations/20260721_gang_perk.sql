-- Xocks Gang phone-number checkout perk: once a member's order is verified
-- valid, their phone number becomes a personal Shopify discount code for a
-- fixed amount off the order (e.g. "buy 6 get 2 free" priced at RM13.99/pair
-- = RM27.98 off once 8+ pairs are in the cart). The exact numbers change
-- yearly, so they live in a small admin-editable config table rather than
-- being hardcoded.

CREATE TABLE IF NOT EXISTS public.gang_perk_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  price_per_pair NUMERIC(10, 2) NOT NULL,
  free_pairs INTEGER NOT NULL,
  min_buy_pairs INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gang_perk_config_active ON public.gang_perk_config(active);

ALTER TABLE public.gang_perk_config ENABLE ROW LEVEL SECURITY;
-- No policies = service-role only (same as the rest of the Gang feature).

-- Perk state lives on the member, not the order — one code per member, ever.
ALTER TABLE public.gang_members ADD COLUMN IF NOT EXISTS shopify_customer_id TEXT;
ALTER TABLE public.gang_members ADD COLUMN IF NOT EXISTS shopify_discount_code TEXT;
ALTER TABLE public.gang_members ADD COLUMN IF NOT EXISTS perk_granted_at TIMESTAMPTZ;
