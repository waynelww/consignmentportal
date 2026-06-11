-- Payment receipt submission: store owners upload bank-transfer proof for a
-- commission period; admins review against the expected amount and confirm.
-- Run in the Supabase SQL editor.

-- ─── 1. Receipts table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  commission_period_id UUID NOT NULL UNIQUE REFERENCES public.commission_periods(id),
  store_id UUID NOT NULL REFERENCES public.stores(id),
  -- storage path inside the private 'payment-receipts' bucket: {store_code}/{file}
  file_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  bank_reference TEXT,
  transfer_date DATE,
  store_notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'confirmed', 'rejected')),
  admin_notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_store_created
  ON public.payment_receipts(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_status
  ON public.payment_receipts(status);

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

-- Reads: owners see their own store's receipts, admins see all.
-- (Lets the existing browser-client pages embed receipts via the FK join.)
DROP POLICY IF EXISTS "View payment receipts" ON public.payment_receipts;
CREATE POLICY "View payment receipts" ON public.payment_receipts
  FOR SELECT USING (
    store_id = get_user_store_id()
    OR get_user_role() IN ('super_admin', 'ops_manager')
  );
-- Writes: none for clients — all inserts/updates go through API routes using
-- the service-role client.

-- ─── 2. New notification types ──────────────────────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'low_stock_alert', 'restock_request', 'do_dispatched', 'do_delivered',
  'commission_ready', 'commission_paid', 'performance_warning', 'new_store_added',
  'payment_receipt_submitted', 'payment_receipt_confirmed', 'payment_receipt_rejected'
));

-- ─── 3. Private storage bucket + policies ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts', 'payment-receipts', false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Service role: full access (API routes stream files to admins)
DROP POLICY IF EXISTS "payment receipts service access" ON storage.objects;
CREATE POLICY "payment receipts service access" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'payment-receipts')
  WITH CHECK (bucket_id = 'payment-receipts');

-- Store owners upload DIRECTLY from the browser into their own store_code
-- folder (avoids serverless body-size limits). First path segment must match
-- the caller's store_code.
DROP POLICY IF EXISTS "payment receipts owner upload" ON storage.objects;
CREATE POLICY "payment receipts owner upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[1] = (
      SELECT s.store_code FROM public.stores s
      JOIN public.profiles p ON p.store_id = s.id
      WHERE p.id = auth.uid()
    )
  );

-- Owners can read back their own folder; admins read everything.
DROP POLICY IF EXISTS "payment receipts read" ON storage.objects;
CREATE POLICY "payment receipts read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (
      (storage.foldername(name))[1] = (
        SELECT s.store_code FROM public.stores s
        JOIN public.profiles p ON p.store_id = s.id
        WHERE p.id = auth.uid()
      )
      OR get_user_role() IN ('super_admin', 'ops_manager')
    )
  );
