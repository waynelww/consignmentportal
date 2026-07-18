-- Unified inventory transfer ledger.
--
-- Every place stock can physically sit (Office, Central Market, IOI,
-- Custom Printing, or any one-off Event) is a row in stock_locations.
-- Every movement of stock — inbound, outbound, or between two locations —
-- is one row in stock_transfers. location_stock holds the current running
-- balance per location+product, maintained by applying transfers.
--
-- from_location_id NULL  = stock entering the tracked system from outside
--                           (new stock arriving, e.g. from the factory)
-- to_location_id   NULL  = stock leaving the tracked system entirely
--                           (sold to a customer, damaged/written off)
-- both set                = an internal transfer between two locations
--
-- This supersedes the (never-populated) warehouse_stock_movements /
-- events / event_stock_items design from the previous version of this
-- migration — replaced before it was ever run in production.

CREATE TABLE IF NOT EXISTS public.stock_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('office', 'retail', 'printing', 'event')),
  event_id UUID, -- set only when type = 'event'; FK added after events table exists below
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
  stock_location_id UUID REFERENCES public.stock_locations(id),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

ALTER TABLE public.stock_locations ADD CONSTRAINT stock_locations_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.location_stock (
  location_id UUID REFERENCES public.stock_locations(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (location_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  from_location_id UUID REFERENCES public.stock_locations(id),
  to_location_id UUID REFERENCES public.stock_locations(id),
  reason TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT at_least_one_location CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_product ON public.stock_transfers(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON public.stock_transfers(from_location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON public.stock_transfers(to_location_id, created_at DESC);

ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage stock locations" ON public.stock_locations
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));
CREATE POLICY "Admins manage events" ON public.events
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));
CREATE POLICY "Admins view location stock" ON public.location_stock
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
CREATE POLICY "Admins view stock transfers" ON public.stock_transfers
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));
-- No client-side INSERT/UPDATE policy on location_stock or stock_transfers —
-- all writes go through the service-role transfer function so the two
-- tables can never drift out of sync with each other.

-- Seed the fixed locations. Office carries forward existing warehouse_stock
-- balances so nothing already entered is lost.
INSERT INTO public.stock_locations (name, type)
VALUES ('Office', 'office'), ('Central Market', 'retail'), ('IOI', 'retail'), ('Custom Printing', 'printing')
ON CONFLICT DO NOTHING;

INSERT INTO public.location_stock (location_id, product_id, quantity)
SELECT (SELECT id FROM public.stock_locations WHERE type = 'office' LIMIT 1), ws.product_id, ws.quantity
FROM public.warehouse_stock ws
ON CONFLICT (location_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity;
