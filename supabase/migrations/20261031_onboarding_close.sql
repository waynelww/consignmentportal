-- Onboarding: remove a store from the board when the deal is off, and reopen it.
-- Nothing is deleted. A closed card keeps its step, so reopening puts it back
-- where it was. Closes and reopens are written to the history.
--
-- Additive only. Existing history rows get event = 'moved'.

-- 1. Close fields on the card. All NULL while open, all set while closed.
ALTER TABLE public.onboarding_cards
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS close_note TEXT,
  ADD COLUMN IF NOT EXISTS closed_by_member_id UUID REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT;

ALTER TABLE public.onboarding_cards DROP CONSTRAINT IF EXISTS onboarding_cards_close_reason;
ALTER TABLE public.onboarding_cards ADD CONSTRAINT onboarding_cards_close_reason CHECK (
  close_reason IS NULL OR close_reason IN ('deal_rejected', 'no_response', 'not_a_fit', 'other')
);

ALTER TABLE public.onboarding_cards DROP CONSTRAINT IF EXISTS onboarding_cards_closed_fields;
ALTER TABLE public.onboarding_cards ADD CONSTRAINT onboarding_cards_closed_fields CHECK (
  (closed_at IS NULL) = (close_reason IS NULL)
  AND (closed_at IS NULL) = (closed_by_member_id IS NULL)
);

-- 2. History: each row says what happened ('moved', 'closed' or 'reopened') and an optional note.
ALTER TABLE public.onboarding_card_history
  ADD COLUMN IF NOT EXISTS event TEXT NOT NULL DEFAULT 'moved',
  ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE public.onboarding_card_history DROP CONSTRAINT IF EXISTS onboarding_card_history_event;
ALTER TABLE public.onboarding_card_history ADD CONSTRAINT onboarding_card_history_event CHECK (
  event IN ('moved', 'closed', 'reopened')
);
