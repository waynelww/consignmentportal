-- Global promos (store_id IS NULL) + Buy X Free Y discount type.

ALTER TABLE public.store_promos ALTER COLUMN store_id DROP NOT NULL;

ALTER TABLE public.store_promos DROP CONSTRAINT IF EXISTS store_promos_discount_type_check;
ALTER TABLE public.store_promos ADD CONSTRAINT store_promos_discount_type_check
  CHECK (discount_type IN ('percentage', 'fixed', 'bxgy'));

ALTER TABLE public.store_promos ADD COLUMN IF NOT EXISTS buy_quantity INTEGER;
ALTER TABLE public.store_promos ADD COLUMN IF NOT EXISTS free_quantity INTEGER;

-- For BXGY, discount_value is unused (kept ≥ 0 for the NOT NULL constraint)
ALTER TABLE public.store_promos ALTER COLUMN discount_value DROP NOT NULL;

-- Replace the RLS policy so globals are readable by all authenticated users.
DROP POLICY IF EXISTS store_owner_own_promos_all ON public.store_promos;
DROP POLICY IF EXISTS store_promos_select ON public.store_promos;

CREATE POLICY store_promos_select ON public.store_promos FOR SELECT USING (
  store_id IS NULL
  OR store_id IN (SELECT store_id FROM public.profiles WHERE id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'ops_manager'))
);
