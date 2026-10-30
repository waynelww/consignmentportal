-- Send log for the monthly report: one row per attempt, written by the monthly
-- cron and by the admin "Send test report" button (lib/monthly-report/send-log.ts).
-- Additive: a new table only. Rows are never edited or deleted by the app.
--
-- NOT APPLIED YET. Paste into the Supabase SQL editor for project
-- mhdyurnrmpjxsjbhbxrp after the operator has approved it.

CREATE TABLE IF NOT EXISTS public.monthly_report_sends (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  month_covered TEXT NOT NULL CHECK (month_covered ~ '^[0-9]{4}-[0-9]{2}$'),
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind          TEXT NOT NULL CHECK (kind IN ('monthly', 'test')),
  recipient     TEXT,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_monthly_report_sends_sent_at
  ON public.monthly_report_sends (sent_at DESC);

ALTER TABLE public.monthly_report_sends ENABLE ROW LEVEL SECURITY;

-- Admins can read the log. There is no insert/update/delete policy, so only the
-- service role (the cron and the admin route) can write to it.
DROP POLICY IF EXISTS monthly_report_sends_admin_read ON public.monthly_report_sends;
CREATE POLICY monthly_report_sends_admin_read ON public.monthly_report_sends
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'ops_manager')
    )
  );
