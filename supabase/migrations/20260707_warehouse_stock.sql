-- warehouse_stock never actually existed in the DB — the Stock page's
-- "Warehouse Stock" section has been silently failing (empty reads,
-- failed saves) since it was built. Creating it properly now that the
-- Stock page is being wired to actually use it.
CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage warehouse stock" ON public.warehouse_stock
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));
