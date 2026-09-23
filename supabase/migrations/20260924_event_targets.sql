-- Event Target Calculator: per-person per-day sales targets for booth crews.
-- Separate from the existing `events` table (booth inventory checkout/return).

CREATE TABLE IF NOT EXISTS public.event_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE,
  event_level TEXT NOT NULL DEFAULT 'medium' CHECK (event_level IN ('small','medium','major')),
  per_head_tier2 NUMERIC(10,2) NOT NULL,        -- copied from settings (or override) at save time
  rental NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery NUMERIC(10,2) NOT NULL DEFAULT 280,
  other_fixed NUMERIC(10,2) NOT NULL DEFAULT 300,
  pt_daily_rate NUMERIC(10,2) NOT NULL DEFAULT 120,
  pt_days INTEGER NOT NULL DEFAULT 0,           -- derived: sum of crew across days
  fixed_cost NUMERIC(10,2) NOT NULL DEFAULT 0,  -- derived
  tier1_total NUMERIC(10,2) NOT NULL DEFAULT 0, -- derived
  tier2_total NUMERIC(10,2) NOT NULL DEFAULT 0, -- derived
  tier3_total NUMERIC(10,2) NOT NULL DEFAULT 0, -- derived
  cover_ratio NUMERIC(8,2) NOT NULL DEFAULT 0,  -- derived: tier2_total / fixed_cost
  actual_sales NUMERIC(10,2),
  tier2_hits INTEGER,
  review_notes TEXT,
  locked_at TIMESTAMPTZ,
  audit_log JSONB NOT NULL DEFAULT '[]'::jsonb, -- lock/unlock history
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_target_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_target_id UUID NOT NULL REFERENCES public.event_targets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  crew INTEGER NOT NULL DEFAULT 0,
  weight_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  day_target_tier2 NUMERIC(10,2) NOT NULL DEFAULT 0,
  per_person_tier1 NUMERIC(10,2) NOT NULL DEFAULT 0,
  per_person_tier2 NUMERIC(10,2) NOT NULL DEFAULT 0,
  per_person_tier3 NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_target_days_event ON public.event_target_days(event_target_id);

-- Single-row settings table; the one row is keyed id = 1.
CREATE TABLE IF NOT EXISTS public.event_target_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  per_head_small NUMERIC(10,2) NOT NULL DEFAULT 500,
  per_head_medium NUMERIC(10,2) NOT NULL DEFAULT 800,
  per_head_major NUMERIC(10,2) NOT NULL DEFAULT 1200,
  tier1_pct_of_tier2 NUMERIC(6,2) NOT NULL DEFAULT 70,
  tier3_pct_of_tier2 NUMERIC(6,2) NOT NULL DEFAULT 150,
  bonus_tier1 NUMERIC(10,2) NOT NULL DEFAULT 20,
  bonus_tier2 NUMERIC(10,2) NOT NULL DEFAULT 50,
  bonus_tier3 NUMERIC(10,2) NOT NULL DEFAULT 100,
  round_to NUMERIC(10,2) NOT NULL DEFAULT 10,
  avg_sale_per_customer NUMERIC(10,2) NOT NULL DEFAULT 50,
  min_cover_ratio NUMERIC(6,2) NOT NULL DEFAULT 2.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.event_target_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Admin-only tables: RLS on, no public policies (service role bypasses RLS;
-- all access goes through the authenticated admin API routes).
ALTER TABLE public.event_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_target_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_target_settings ENABLE ROW LEVEL SECURITY;
