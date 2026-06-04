-- Store-owner-created promos applied to multi-item sales.

CREATE TABLE IF NOT EXISTS public.store_promos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.stores(id) NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  min_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_promos_store_id ON public.store_promos(store_id);
CREATE INDEX IF NOT EXISTS idx_store_promos_code ON public.store_promos(store_id, code) WHERE code IS NOT NULL;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS promo_id UUID REFERENCES public.store_promos(id),
  ADD COLUMN IF NOT EXISTS promo_discount DECIMAL(10,2) DEFAULT 0;

-- RLS policy so store_owners only see/manage their own promos
ALTER TABLE public.store_promos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_owner_own_promos_select ON public.store_promos;
CREATE POLICY store_owner_own_promos_select ON public.store_promos
  FOR SELECT USING (
    store_id IN (SELECT store_id FROM public.profiles WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'ops_manager'))
  );

DROP POLICY IF EXISTS store_owner_own_promos_modify ON public.store_promos;
CREATE POLICY store_owner_own_promos_modify ON public.store_promos
  FOR ALL USING (
    store_id IN (SELECT store_id FROM public.profiles WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'ops_manager'))
  );
