-- Event close counts: the admin's typed "Returned" figure per SKU when an
-- event is closed, next to what XCMS expected to be left, so the close
-- history stays exact. (Leftover event stock itself is zeroed in the
-- stock_transfers ledger with "Event closed — returned: <event>"; it is
-- never added to Office.)
--
--   expected_left = units in the event location after any "sold outside POS"
--                   deduction, i.e. what should physically have come back
--   returned      = what the admin typed on the close screen
--   variance      = returned − expected_left (0 = tallies)
--
-- Written only by /api/events/[eventId]/close with the service role.
-- One row per event + product; a retried close overwrites its own rows.

CREATE TABLE IF NOT EXISTS public.event_close_counts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id),
  expected_left INTEGER NOT NULL CHECK (expected_left >= 0),
  returned      INTEGER NOT NULL CHECK (returned >= 0),
  variance      INTEGER GENERATED ALWAYS AS (returned - expected_left) STORED,
  closed_by     UUID REFERENCES public.profiles(id),
  closed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_event_close_counts_event ON public.event_close_counts(event_id);

ALTER TABLE public.event_close_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view event close counts" ON public.event_close_counts
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
-- No client-side INSERT/UPDATE/DELETE policy: writes go through the close API.
