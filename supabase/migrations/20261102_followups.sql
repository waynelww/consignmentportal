-- Follow-ups: the monthly checklist of consignment follow-ups (admin only).
--
-- Additive only: two new tables and their indexes, guards and RLS. Nothing is
-- dropped, rewritten or backfilled. XCMS stores' auto boxes are NOT stored
-- here; they are worked out from sales, commission_periods, payment_receipts
-- and delivery_orders on each load. Apply once, after the operator's OK, before
-- the Follow-ups page goes live.

-- 1. Extra stores: stores that are not in XCMS, followed up by hand.
--    Hiding sets active = false; nothing is deleted, so past ticks stay.
CREATE TABLE IF NOT EXISTS public.followup_extra_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  pic_name TEXT CHECK (pic_name IS NULL OR length(btrim(pic_name)) BETWEEN 1 AND 120),
  pic_phone TEXT CHECK (pic_phone IS NULL OR length(btrim(pic_phone)) BETWEEN 1 AND 30),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Active names are unique (ignoring case and spaces at the ends).
CREATE UNIQUE INDEX IF NOT EXISTS uq_followup_extra_stores_active_name
  ON public.followup_extra_stores (lower(btrim(name)))
  WHERE active;

-- 2. Who added, hid and restored each extra store. Append-only.
CREATE TABLE IF NOT EXISTS public.followup_extra_store_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extra_store_id UUID NOT NULL REFERENCES public.followup_extra_stores(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('added', 'hidden', 'restored')),
  by_member_id UUID NOT NULL REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followup_extra_store_history_store
  ON public.followup_extra_store_history (extra_store_id, created_at);

-- 3. The checklist log. One row per manual tick, untick or note, and per
--    XCMS note. Every row is a full snapshot of that cell after the change
--    (ticked and note), so the newest row for a cell is its current state.
--    Append-only: rows are never edited or deleted.
CREATE TABLE IF NOT EXISTS public.followup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Month the checklist row belongs to, 'YYYY-MM' (Malaysia calendar month).
  period_month TEXT NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- Exactly one of these: an XCMS store, or an extra store.
  store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT,
  extra_store_id UUID REFERENCES public.followup_extra_stores(id) ON DELETE RESTRICT,
  item TEXT NOT NULL CHECK (item IN ('sales_report', 'invoice', 'payment', 'restock')),
  action TEXT NOT NULL CHECK (action IN ('tick', 'untick', 'note')),
  -- Box state after this change. NULL for XCMS stores (their boxes are automatic).
  ticked BOOLEAN,
  -- Note after this change. NULL means no note.
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  by_member_id UUID NOT NULL REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT followup_log_one_store CHECK ((store_id IS NULL) <> (extra_store_id IS NULL)),
  CONSTRAINT followup_log_shape CHECK (
    (store_id IS NOT NULL AND ticked IS NULL AND action = 'note')
    OR (extra_store_id IS NOT NULL AND ticked IS NOT NULL AND (
      (action = 'tick' AND ticked)
      OR (action = 'untick' AND NOT ticked)
      OR action = 'note'
    ))
  )
);

CREATE INDEX IF NOT EXISTS idx_followup_log_store
  ON public.followup_log (period_month, store_id, item, created_at)
  WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_followup_log_extra
  ON public.followup_log (period_month, extra_store_id, item, created_at)
  WHERE extra_store_id IS NOT NULL;

-- 4. Append-only guards. Any UPDATE or DELETE on the two history tables fails.
CREATE OR REPLACE FUNCTION public.followup_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Follow-up history rows cannot be changed or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_followup_log_guard ON public.followup_log;
CREATE TRIGGER trg_followup_log_guard
  BEFORE UPDATE OR DELETE ON public.followup_log
  FOR EACH ROW EXECUTE FUNCTION public.followup_append_only_guard();

DROP TRIGGER IF EXISTS trg_followup_extra_store_history_guard ON public.followup_extra_store_history;
CREATE TRIGGER trg_followup_extra_store_history_guard
  BEFORE UPDATE OR DELETE ON public.followup_extra_store_history
  FOR EACH ROW EXECUTE FUNCTION public.followup_append_only_guard();

-- 5. Row level security: admins read; all writes go through the admin API
--    routes (service role), which check the caller's role and record who acted.
ALTER TABLE public.followup_extra_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "followup_extra_stores select" ON public.followup_extra_stores;
CREATE POLICY "followup_extra_stores select" ON public.followup_extra_stores
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));

ALTER TABLE public.followup_extra_store_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "followup_extra_store_history select" ON public.followup_extra_store_history;
CREATE POLICY "followup_extra_store_history select" ON public.followup_extra_store_history
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));

ALTER TABLE public.followup_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "followup_log select" ON public.followup_log;
CREATE POLICY "followup_log select" ON public.followup_log
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
