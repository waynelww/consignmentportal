-- HR lockdown: nothing HR-related is readable or writable with a normal XCMS
-- login any more. All HR data goes through the API routes, which use the
-- service role after checking either the HR admin (wayne@xocks.co,
-- lib/hr/admins.ts) or a staff PIN session on the /hr link.
--
-- 1. Drop the SELECT policies on the HR tables. RLS stays on with no
--    policies, so signed-in users (ops_manager, store owners) get nothing
--    even if they query the database directly.
-- 2. Move PIN hashes off xocks_team_members (which ops_manager can read) into
--    hr_member_pins (server-only), then drop the old column.
-- 3. Move the HR settings out of public.settings (readable by every login,
--    writable by ops_manager) into hr_secrets (server-only).
--
-- Apply after 20261106_hr_join_date_replacement.sql.

-- 1 ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "hr_claims select" ON public.hr_claims;
DROP POLICY IF EXISTS "hr_leaves select" ON public.hr_leaves;
DROP POLICY IF EXISTS "hr_penalties select" ON public.hr_penalties;
DROP POLICY IF EXISTS "hr_public_holidays select" ON public.hr_public_holidays;
DROP POLICY IF EXISTS "hr_rest_day_work select" ON public.hr_rest_day_work;
DROP POLICY IF EXISTS "hr_audit_log select" ON public.hr_audit_log;

REVOKE ALL ON public.hr_claims, public.hr_leaves, public.hr_penalties, public.hr_public_holidays,
  public.hr_rest_day_work, public.hr_audit_log, public.hr_secrets FROM anon, authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hr_member_pins (
  member_id UUID PRIMARY KEY REFERENCES public.xocks_team_members(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_member_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_member_pins FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'xocks_team_members' AND column_name = 'hr_pin_hash') THEN
    INSERT INTO public.hr_member_pins (member_id, pin_hash)
    SELECT id, hr_pin_hash FROM public.xocks_team_members WHERE hr_pin_hash IS NOT NULL
    ON CONFLICT (member_id) DO NOTHING;
    ALTER TABLE public.xocks_team_members DROP COLUMN hr_pin_hash;
  END IF;
END $$;

-- 3 ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.hr_secrets (key, value)
SELECT key, value FROM public.settings
WHERE key IN ('hr_report_email', 'hr_late_penalty_default', 'hr_work_days') AND value IS NOT NULL
ON CONFLICT (key) DO NOTHING;
DELETE FROM public.settings WHERE key IN ('hr_report_email', 'hr_late_penalty_default', 'hr_work_days');
