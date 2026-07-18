-- Inventory tracking: office stock accountability + event stock checkout/return.
--
-- warehouse_stock_movements is the audit trail behind every office stock
-- change, whatever the cause (manual adjustment, event checkout/return).
-- No UPDATE/DELETE policy is defined on purpose — rows are append-only.
CREATE TABLE IF NOT EXISTS public.warehouse_stock_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  delta INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_type TEXT CHECK (reference_type IN ('manual', 'event_checkout', 'event_return')),
  reference_id UUID,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_movements_product ON public.warehouse_stock_movements(product_id, created_at DESC);

ALTER TABLE public.warehouse_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view warehouse movements" ON public.warehouse_stock_movements
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));

CREATE POLICY "Admins insert warehouse movements" ON public.warehouse_stock_movements
  FOR INSERT WITH CHECK (get_user_role() IN ('super_admin', 'ops_manager'));

-- Events: pop-ups / roadshows / one-off stock deployments outside the
-- consignment store network.
CREATE TABLE IF NOT EXISTS public.events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  shopify_location_id TEXT,
  shopify_location_name TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage events" ON public.events
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Per-SKU checkout/return ledger for an event.
CREATE TABLE IF NOT EXISTS public.event_stock_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  quantity_taken INTEGER NOT NULL DEFAULT 0,
  quantity_sold_shopify INTEGER,
  quantity_returned INTEGER,
  variance INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, product_id)
);

ALTER TABLE public.event_stock_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage event stock items" ON public.event_stock_items
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));
