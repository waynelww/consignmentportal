-- Store staff: the people at each store who key in sales.
-- Names are never deleted. "Removing" a name sets active = false, so every
-- past sale keeps its staff link and still shows the name.

CREATE TABLE IF NOT EXISTS public.store_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Active names are unique per store (ignoring case and spaces at the ends).
-- Hidden names are not counted, so a name can be re-added after it was hidden.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_staff_active_name
  ON public.store_staff (store_id, lower(btrim(name)))
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_store_staff_store ON public.store_staff (store_id);

ALTER TABLE public.store_staff ENABLE ROW LEVEL SECURITY;

-- Reads only. All writes go through /api/store-staff, which checks the caller
-- is an admin or the store's own owner, then writes with the service role.
DROP POLICY IF EXISTS "store_staff select" ON public.store_staff;
CREATE POLICY "store_staff select" ON public.store_staff
  FOR SELECT USING (
    store_id = get_user_store_id()
    OR get_user_role() IN ('super_admin', 'ops_manager')
  );

-- Who keyed in each sale. Nullable: sales recorded before this migration
-- (and any sale recorded with no staff selected) show "-".
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS store_staff_id UUID REFERENCES public.store_staff(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_sales_store_staff ON public.sales (store_staff_id);
