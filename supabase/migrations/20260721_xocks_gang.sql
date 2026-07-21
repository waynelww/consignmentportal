-- Xocks Gang: customer loyalty registration via QR code on the thank-you
-- card. Customers buy on Shopee/TikTok/website (platforms we don't own
-- customer data for) and register their phone/name/email + order number so
-- the team can remarket via WhatsApp. Order numbers are confirmed against a
-- daily list the team uploads (via the Telegram bot) since paid orders
-- often lag physical stock. Prize tiers are team-configured display data
-- only — the system tracks entries, it does not auto-select winners.

-- ─── 1. Gang members (permanent profile, keyed by phone) ───────────────────
CREATE TABLE IF NOT EXISTS public.gang_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gang_members_phone ON public.gang_members(phone);

ALTER TABLE public.gang_members ENABLE ROW LEVEL SECURITY;
-- No policies = no anon/authenticated access. Only the service-role admin
-- client (public registration API + bot API) touches this table.

-- ─── 2. Order submissions (one row per order number a member submits) ──────
CREATE TABLE IF NOT EXISTS public.gang_order_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES public.gang_members(id),
  order_number TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('shopee', 'tiktok', 'website', 'instagram', 'instore')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'valid', 'invalid')),
  submitted_date DATE NOT NULL DEFAULT CURRENT_DATE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gang_submissions_member ON public.gang_order_submissions(member_id);
CREATE INDEX IF NOT EXISTS idx_gang_submissions_status_date ON public.gang_order_submissions(status, submitted_date);
CREATE INDEX IF NOT EXISTS idx_gang_submissions_order_number ON public.gang_order_submissions(order_number);

ALTER TABLE public.gang_order_submissions ENABLE ROW LEVEL SECURITY;
-- No policies = service-role only.

-- ─── 3. Daily valid-order ground truth (uploaded by the team via bot) ──────
CREATE TABLE IF NOT EXISTS public.gang_valid_orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  platform TEXT,
  batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gang_valid_orders_order_number ON public.gang_valid_orders(order_number);

ALTER TABLE public.gang_valid_orders ENABLE ROW LEVEL SECURITY;
-- No policies = service-role only.

-- ─── 4. Prize tiers (team-configured, customer-visible display data) ───────
CREATE TABLE IF NOT EXISTS public.gang_prizes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cadence TEXT NOT NULL CHECK (cadence IN ('monthly', 'daily')),
  tier_label TEXT NOT NULL,
  prize_label TEXT NOT NULL,
  -- Free text, e.g. "1 / 10,000", "rolling", "guaranteed" — the team
  -- supplies odds, the system just displays them.
  probability_text TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gang_prizes_active ON public.gang_prizes(active, cadence, sort_order);

ALTER TABLE public.gang_prizes ENABLE ROW LEVEL SECURITY;
-- No policies = service-role only. The public GET /api/gang/prizes route
-- reads via the admin client and filters to active=true itself.
