-- Store drafts: parked form state for incomplete store-creation flows.
-- The "data" JSON holds whatever the admin had typed; only when they finish
-- does it become a real row in the stores table.

CREATE TABLE IF NOT EXISTS public.store_drafts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID REFERENCES public.profiles(id) NOT NULL,
  title TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_drafts_creator
  ON public.store_drafts(created_by, updated_at DESC);

ALTER TABLE public.store_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_drafts_own ON public.store_drafts;
CREATE POLICY store_drafts_own ON public.store_drafts FOR ALL USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'ops_manager'))
);
