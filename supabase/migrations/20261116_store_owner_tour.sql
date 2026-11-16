-- Store owner guided tour: per-owner tour state on public.profiles.
--
-- NOT APPLIED. Apply with the Supabase connector's apply_migration tool only
-- after the operator has reviewed this SQL and approved it.
--
-- Apply BEFORE deploying the code that writes tour_status on new store owners
-- (app/api/stores/route.ts), otherwise the Add Store profile insert fails on
-- the unknown column.

-- 1. Columns ------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tour_status text
    CHECK (tour_status IN ('new', 'offer', 'snoozed', 'declined', 'in_progress', 'completed')),
  ADD COLUMN IF NOT EXISTS tour_step int,
  ADD COLUMN IF NOT EXISTS tour_lang text NOT NULL DEFAULT 'en'
    CHECK (tour_lang IN ('en', 'bm')),
  ADD COLUMN IF NOT EXISTS tour_completed_at timestamptz;

-- 2. Backfill: existing store owners are offered the tour once ----------------
UPDATE public.profiles
   SET tour_status = 'offer'
 WHERE role = 'store_owner'
   AND tour_status IS NULL;

-- 3. Permissions: owners may change only their own tour columns ---------------
-- Row scope is already enforced by the existing policy
-- "Users can update own profile" (USING id = auth.uid()). Column grants add the
-- column scope: the browser role can UPDATE only the four tour columns, so it
-- cannot change role, store_id, full_name or phone.
-- All other profile writes in the app run server-side with the service or
-- admin client, which these grants do not affect.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (tour_status, tour_step, tour_lang, tour_completed_at)
  ON public.profiles TO authenticated;
