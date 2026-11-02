-- HR: statutory leave from join date + replacement leave for rest-day work.
--
-- 1. join_date on xocks_team_members. When set (and custom_entitlement is
--    false) annual leave and MC are the Employment Act 1955 minimums worked
--    out from it (lib/hr/rules.ts statutoryEntitlements). Without a join date,
--    or with custom_entitlement = true, the stored annual_leave_days / mc_days
--    are used as before.
-- 2. hr_rest_day_work: staff log work on a rest day or public holiday (booth
--    events); each approved row earns 1 or 0.5 replacement days.
-- 3. hr_leaves gains leave_type 'replacement', taken from those earned days.
--
-- Additive. Apply after 20261105_hr_drive_secrets.sql.

ALTER TABLE public.xocks_team_members
  ADD COLUMN IF NOT EXISTS join_date DATE CHECK (join_date IS NULL OR join_date >= '1990-01-01'),
  ADD COLUMN IF NOT EXISTS custom_entitlement BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.hr_leaves DROP CONSTRAINT IF EXISTS hr_leaves_leave_type_check;
ALTER TABLE public.hr_leaves ADD CONSTRAINT hr_leaves_leave_type_check
  CHECK (leave_type IN ('annual', 'emergency', 'unpaid', 'mc', 'replacement'));

CREATE TABLE IF NOT EXISTS public.hr_rest_day_work (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  work_date DATE NOT NULL,
  -- Worked out by the API from hr_work_days and hr_public_holidays.
  day_kind TEXT NOT NULL CHECK (day_kind IN ('rest_day', 'public_holiday')),
  days_earned NUMERIC(3,1) NOT NULL CHECK (days_earned IN (0.5, 1)),
  event_name TEXT NOT NULL CHECK (length(btrim(event_name)) BETWEEN 1 AND 120),
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_rest_day_work_member ON public.hr_rest_day_work (member_id, work_date);
CREATE INDEX IF NOT EXISTS idx_hr_rest_day_work_status ON public.hr_rest_day_work (status);
-- One log per person per day (rejected ones don't block a corrected re-log).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_rest_day_work_day
  ON public.hr_rest_day_work (member_id, work_date) WHERE status <> 'rejected';

ALTER TABLE public.hr_rest_day_work ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hr_rest_day_work select" ON public.hr_rest_day_work;
CREATE POLICY "hr_rest_day_work select" ON public.hr_rest_day_work
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
