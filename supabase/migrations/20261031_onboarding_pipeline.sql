-- Onboarding pipeline: tracks each new consignment store from first contact
-- to first sale. Manual only (no automation, no store-side changes).
--
-- Additive only: nothing is dropped, rewritten or backfilled. Apply once
-- (after the operator's OK) before the Onboarding tab goes live.

-- 1. Shipment details on stores. Shown on delivery orders and packing slips
--    when filled. Nullable: existing stores stay blank until someone fills them.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS shipment_address TEXT,
  ADD COLUMN IF NOT EXISTS shipment_contact TEXT,
  ADD COLUMN IF NOT EXISTS shipment_pic TEXT;

-- 2. One card per store being onboarded. The card can exist before the store
--    does; store_id is set when the store record is created (or linked).
CREATE TABLE IF NOT EXISTS public.onboarding_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name TEXT NOT NULL CHECK (length(btrim(store_name)) BETWEEN 1 AND 120),
  pic_name TEXT NOT NULL CHECK (length(btrim(pic_name)) BETWEEN 1 AND 120),
  -- The single "company / PIC phone" field; also the WhatsApp number on the card.
  pic_phone TEXT NOT NULL CHECK (length(btrim(pic_phone)) BETWEEN 1 AND 30),
  company_name TEXT,
  company_address TEXT,
  company_email TEXT,
  shipment_address TEXT,
  shipment_contact TEXT,
  shipment_pic TEXT,
  store_type TEXT,
  notes TEXT,
  step TEXT NOT NULL DEFAULT 'reached_out' CHECK (step IN (
    'reached_out', 'agreement_made', 'details_received', 'account_created',
    'group_opened', 'catalogue_sent', 'stock_picked', 'delivered', 'first_sale'
  )),
  step_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when the card reaches First sale; the card leaves the board 7 days later.
  first_sale_at TIMESTAMPTZ,
  follow_up_date DATE,
  handler_member_id UUID REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  -- Linked store. Required from Account created onwards (enforced below).
  store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT,
  updated_by_member_id UUID REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_cards_first_sale_at CHECK (
    (step = 'first_sale') = (first_sale_at IS NOT NULL)
  ),
  CONSTRAINT onboarding_cards_store_link CHECK (
    store_id IS NOT NULL OR step IN ('reached_out', 'agreement_made', 'details_received')
  )
);

-- A store belongs to at most one card.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_cards_store
  ON public.onboarding_cards (store_id)
  WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onboarding_cards_step
  ON public.onboarding_cards (step, step_changed_at);

-- 3. Step history. One row per step change, including the first row when the
--    card is created (from_step NULL). Append-only: rows are never edited or
--    deleted, so the history can be trusted when pulled later.
CREATE TABLE IF NOT EXISTS public.onboarding_card_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES public.onboarding_cards(id) ON DELETE RESTRICT,
  from_step TEXT CHECK (from_step IS NULL OR from_step IN (
    'reached_out', 'agreement_made', 'details_received', 'account_created',
    'group_opened', 'catalogue_sent', 'stock_picked', 'delivered', 'first_sale'
  )),
  to_step TEXT NOT NULL CHECK (to_step IN (
    'reached_out', 'agreement_made', 'details_received', 'account_created',
    'group_opened', 'catalogue_sent', 'stock_picked', 'delivered', 'first_sale'
  )),
  -- Who moved it: a Xocks team member picked in the app (the admin login is shared).
  moved_by_member_id UUID NOT NULL REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_card_history_card
  ON public.onboarding_card_history (card_id, moved_at);

CREATE OR REPLACE FUNCTION public.onboarding_card_history_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'onboarding_card_history rows cannot be changed or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_onboarding_card_history_guard ON public.onboarding_card_history;
CREATE TRIGGER trg_onboarding_card_history_guard
  BEFORE UPDATE OR DELETE ON public.onboarding_card_history
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_card_history_guard();

-- 4. Row level security: admins read; all writes go through the admin API
--    routes (service role), which check the caller's role and record who acted.
ALTER TABLE public.onboarding_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "onboarding_cards select" ON public.onboarding_cards;
CREATE POLICY "onboarding_cards select" ON public.onboarding_cards
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));

ALTER TABLE public.onboarding_card_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "onboarding_card_history select" ON public.onboarding_card_history;
CREATE POLICY "onboarding_card_history select" ON public.onboarding_card_history
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
