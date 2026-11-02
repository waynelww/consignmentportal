-- Follow-ups: Restock becomes a hand-ticked box for every store, XCMS stores
-- included (it is no longer derived from delivery orders). Sales Report,
-- Invoice and Payment stay automatic for XCMS stores (note-only in the log).
--
-- Additive only: replaces one CHECK constraint on followup_log so that XCMS
-- store rows for item = 'restock' can carry ticked true/false. Nothing is
-- dropped or rewritten; the table has no rows that the new rule rejects
-- (every existing row is an XCMS or extra-store note that still passes).

ALTER TABLE public.followup_log DROP CONSTRAINT IF EXISTS followup_log_shape;

ALTER TABLE public.followup_log ADD CONSTRAINT followup_log_shape CHECK (
  -- XCMS store: restock is hand-ticked (ticked set); the other items are note-only.
  (store_id IS NOT NULL AND (
    (item = 'restock' AND ticked IS NOT NULL AND (
      (action = 'tick' AND ticked)
      OR (action = 'untick' AND NOT ticked)
      OR action = 'note'
    ))
    OR (item <> 'restock' AND ticked IS NULL AND action = 'note')
  ))
  -- Extra store: every box is hand-ticked.
  OR (extra_store_id IS NOT NULL AND ticked IS NOT NULL AND (
    (action = 'tick' AND ticked)
    OR (action = 'untick' AND NOT ticked)
    OR action = 'note'
  ))
);
