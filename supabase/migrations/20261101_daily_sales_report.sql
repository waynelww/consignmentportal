-- Daily sales report (internal only): per-store switch and recipient list, and
-- the send log. Additive only: two new tables, nothing on stores changes.
-- Rows in daily_report_sends are never edited or deleted by the app.
--
-- Settings live in their own table, not on stores, so store users (who can read
-- their own store row) cannot see the Xocks recipient addresses. Only admins can
-- read it; the app writes it through the service role in admin-checked API routes.
--
-- NOT APPLIED YET. Paste into the Supabase SQL editor for project
-- mhdyurnrmpjxsjbhbxrp after the operator has approved it.

-- One row per store. Missing row = off. The switch cannot be on without at
-- least one recipient.
CREATE TABLE IF NOT EXISTS public.store_daily_report_settings (
  store_id   UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  recipients TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT store_daily_report_needs_recipient
    CHECK (NOT enabled OR cardinality(recipients) >= 1)
);

ALTER TABLE public.store_daily_report_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_daily_report_settings_admin_read ON public.store_daily_report_settings;
CREATE POLICY store_daily_report_settings_admin_read ON public.store_daily_report_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'ops_manager')
    )
  );

-- Existing stores start with the switch off, one row each.
INSERT INTO public.store_daily_report_settings (store_id)
SELECT id FROM public.stores
ON CONFLICT (store_id) DO NOTHING;

-- Send log: one row per store per recipient per attempt (daily cron or the
-- store page's "Send test report"). store_code and store_name are copied in so
-- the history still reads correctly if the store is later renamed or removed.
CREATE TABLE IF NOT EXISTS public.daily_report_sends (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id      UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  store_code    TEXT NOT NULL,
  store_name    TEXT NOT NULL,
  report_date   DATE NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('daily', 'test')),
  recipient     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_report_sends_store
  ON public.daily_report_sends (store_id, sent_at DESC);

ALTER TABLE public.daily_report_sends ENABLE ROW LEVEL SECURITY;

-- Admins can read the log. No insert/update/delete policy, so only the service
-- role (the cron and the admin route) can write to it.
DROP POLICY IF EXISTS daily_report_sends_admin_read ON public.daily_report_sends;
CREATE POLICY daily_report_sends_admin_read ON public.daily_report_sends
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'ops_manager')
    )
  );
