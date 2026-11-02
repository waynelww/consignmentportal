-- HR follow-up: server-only secrets + Google Drive copies of receipts / MC slips.
--
-- 1. hr_secrets: key/value rows only the service role can read (RLS on, no
--    policies). Holds the /hr link password hash (moved out of public.settings,
--    whose read policy is broader) and the Google Drive refresh token.
-- 2. drive_file_id / drive_url on claims and leave: set when the file is
--    copied to Google Drive on approval (lib/hr/drive.ts).
--
-- Additive and idempotent. Apply after 20261102_hr_module.sql.

CREATE TABLE IF NOT EXISTS public.hr_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_secrets ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service role (API routes) can read or write.

-- Move the link password hash over, then remove it from settings.
INSERT INTO public.hr_secrets (key, value)
SELECT 'hr_portal_password_hash', value FROM public.settings
WHERE key = 'hr_portal_password_hash' AND coalesce(value, '') <> ''
ON CONFLICT (key) DO NOTHING;
DELETE FROM public.settings WHERE key = 'hr_portal_password_hash';

ALTER TABLE public.hr_claims
  ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_url TEXT;
ALTER TABLE public.hr_leaves
  ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_url TEXT;
