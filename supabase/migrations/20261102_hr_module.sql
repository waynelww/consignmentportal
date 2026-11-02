-- HR module: claims, leave, MC, late penalties, public holidays.
--
-- Staff are the Xocks team (xocks_team_members). Staff use the public link
-- /hr: a shared link password, then their name + a personal PIN. Every HR
-- record names its person (member_id) and every change is written to
-- hr_audit_log. Only the super_admin reviews, at /admin/hr/manage.
--
-- Additive and idempotent. NOT APPLIED YET. Paste into the Supabase SQL
-- editor for project mhdyurnrmpjxsjbhbxrp after the operator has approved it.

-- ─── 1. Yearly entitlements per person ─────────────────────────────────────
-- Days per calendar year. Defaults are the Employment Act minimums for staff
-- under 2 years' service (8 annual, 14 sick); the admin edits them per person.
ALTER TABLE public.xocks_team_members
  ADD COLUMN IF NOT EXISTS annual_leave_days NUMERIC(4,1) NOT NULL DEFAULT 8 CHECK (annual_leave_days BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS mc_days NUMERIC(4,1) NOT NULL DEFAULT 14 CHECK (mc_days BETWEEN 0 AND 60),
  -- Personal PIN for the /hr link (scrypt hash, lib/hr/portal-session.ts).
  -- NULL = not set yet: the person creates one on their first visit; the
  -- admin can reset it back to NULL.
  ADD COLUMN IF NOT EXISTS hr_pin_hash TEXT;

-- ─── 2. Claims ─────────────────────────────────────────────────────────────
-- pending → approved → paid, or pending → rejected.
CREATE TABLE IF NOT EXISTS public.hr_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  claim_date DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('transport', 'parking_toll', 'meals', 'supplies', 'event', 'other')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  -- Path inside the private 'hr-documents' bucket.
  receipt_path TEXT,
  receipt_name TEXT,
  receipt_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_claims_member ON public.hr_claims (member_id, claim_date);
CREATE INDEX IF NOT EXISTS idx_hr_claims_status ON public.hr_claims (status);

-- ─── 3. Leave and MC ───────────────────────────────────────────────────────
-- annual + emergency use the annual entitlement; mc uses the MC entitlement;
-- unpaid uses neither. `days` = working days at submission time (weekends per
-- the hr_work_days setting and public holidays excluded; 0.5 for a half day).
CREATE TABLE IF NOT EXISTS public.hr_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual', 'emergency', 'unpaid', 'mc')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  half_day BOOLEAN NOT NULL DEFAULT false,
  days NUMERIC(5,1) NOT NULL CHECK (days >= 0),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  -- MC slip (required for mc, enforced in the API). Path in 'hr-documents'.
  attachment_path TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (NOT half_day OR start_date = end_date)
);
CREATE INDEX IF NOT EXISTS idx_hr_leaves_member ON public.hr_leaves (member_id, start_date);
CREATE INDEX IF NOT EXISTS idx_hr_leaves_status ON public.hr_leaves (status);

-- ─── 4. Late / other penalties (logged by the admin) ───────────────────────
CREATE TABLE IF NOT EXISTS public.hr_penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT,
  penalty_date DATE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'late' CHECK (kind IN ('late', 'other')),
  minutes_late INTEGER CHECK (minutes_late IS NULL OR minutes_late BETWEEN 1 AND 1440),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0 AND amount <= 100000),
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_penalties_member ON public.hr_penalties (member_id, penalty_date);

-- ─── 5. Public holidays (skipped when counting leave days) ─────────────────
CREATE TABLE IF NOT EXISTS public.hr_public_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 5b. Activity log: who did what, from which device ─────────────────────
-- Written by the API routes (service role) for every login and every change.
-- Append-only by convention; only the super_admin can read it.
CREATE TABLE IF NOT EXISTS public.hr_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'admin', 'visitor')),
  actor_member_id UUID REFERENCES public.xocks_team_members(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  details JSONB,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_audit_log_created ON public.hr_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_audit_log_member ON public.hr_audit_log (actor_member_id, created_at DESC);

-- ─── 6. RLS: reads for the team login + admin; writes via API routes only ──
ALTER TABLE public.hr_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_audit_log select" ON public.hr_audit_log;
CREATE POLICY "hr_audit_log select" ON public.hr_audit_log
  FOR SELECT USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "hr_claims select" ON public.hr_claims;
CREATE POLICY "hr_claims select" ON public.hr_claims
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
DROP POLICY IF EXISTS "hr_leaves select" ON public.hr_leaves;
CREATE POLICY "hr_leaves select" ON public.hr_leaves
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
DROP POLICY IF EXISTS "hr_penalties select" ON public.hr_penalties;
CREATE POLICY "hr_penalties select" ON public.hr_penalties
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
DROP POLICY IF EXISTS "hr_public_holidays select" ON public.hr_public_holidays;
CREATE POLICY "hr_public_holidays select" ON public.hr_public_holidays
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- ─── 7. Private bucket for receipts and MC slips ───────────────────────────
-- Uploads use signed upload URLs from /api/hr-portal/upload-url; files are
-- streamed back through the API (own files for staff, any for the admin).
-- Service role only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hr-documents', 'hr-documents', false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "hr documents service access" ON storage.objects;
CREATE POLICY "hr documents service access" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'hr-documents')
  WITH CHECK (bucket_id = 'hr-documents');

-- ─── 8. Settings (lib/hr/settings.ts) ──────────────────────────────────────
-- The report recipient starts as the monthly report's recipient.
INSERT INTO public.settings (key, value, description)
SELECT 'hr_report_email', value,
  'Recipient of the monthly HR report (Excel), emailed on the 1st at 10:00 MYT'
FROM public.settings WHERE key = 'monthly_report_email'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value, description) VALUES
  ('hr_late_penalty_default', '10', 'Default RM amount pre-filled when logging a late penalty'),
  ('hr_work_days', '1,2,3,4,5', 'Working days for leave counting, ISO weekday numbers (1 = Mon … 7 = Sun)'),
  -- scrypt hash of the /hr link password. Set from HR Admin → Report & settings
  -- (never written here, so the password is not in git). Blank = link locked.
  ('hr_portal_password_hash', '', 'Hash of the password for the staff HR link (/hr). Change it in HR Admin.')
ON CONFLICT (key) DO NOTHING;
