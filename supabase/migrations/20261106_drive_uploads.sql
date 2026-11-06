-- Google Drive copies of Delivery Orders and monthly invoices (lib/drive/).
--
-- One row per DO / invoice. The app queues a 'pending' row when the record is
-- created or changed; the 15-minute worker (/api/cron/drive-uploads) renders the
-- PDF, uploads it to the Shared Drive and marks the row 'done' (or 'failed'
-- after 5 attempts). Nothing is uploaded inside the user's request.
--
-- Unique (kind, record_id): each DO / invoice has at most one Drive file. A
-- re-queue updates that same file (drive_file_id), it never creates a copy.
--
-- Admin-only read (super_admin, ops_manager), same pattern as the other admin
-- tables. No insert/update/delete policy: only the service role (API routes and
-- the worker) writes here.
--
-- Additive: a new table only. Apply in the Supabase SQL editor after the
-- operator has approved it.

CREATE TABLE IF NOT EXISTS public.drive_uploads (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('delivery_order', 'invoice')),
  record_id     UUID NOT NULL,
  store_id      UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  drive_file_id TEXT,
  drive_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT drive_uploads_kind_record_key UNIQUE (kind, record_id)
);

-- The worker reads pending rows oldest-queued first.
CREATE INDEX IF NOT EXISTS idx_drive_uploads_status_updated
  ON public.drive_uploads (status, updated_at);

ALTER TABLE public.drive_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drive_uploads_admin_read ON public.drive_uploads;
CREATE POLICY drive_uploads_admin_read ON public.drive_uploads
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'ops_manager')
    )
  );
