-- First-timer Gang perks: two personal Shopify discount codes issued when
-- a member's FIRST order is verified.
--   freepair_code : one-time RM13.99-off-any-purchase code (single use)
--   lifetime_code : name-based 10%-off-forever code (e.g. WAYNE10UFG),
--                   no expiry, unlimited uses
ALTER TABLE public.gang_members ADD COLUMN IF NOT EXISTS freepair_code TEXT;
ALTER TABLE public.gang_members ADD COLUMN IF NOT EXISTS freepair_granted_at TIMESTAMPTZ;
ALTER TABLE public.gang_members ADD COLUMN IF NOT EXISTS lifetime_code TEXT;
ALTER TABLE public.gang_members ADD COLUMN IF NOT EXISTS lifetime_granted_at TIMESTAMPTZ;

-- Lifetime codes must be unique across members (they're personal).
CREATE UNIQUE INDEX IF NOT EXISTS idx_gang_members_lifetime_code
  ON public.gang_members(lifetime_code) WHERE lifetime_code IS NOT NULL;
