-- XCMS Database Schema
-- Run this in Supabase SQL editor in order

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE public.stores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_code TEXT UNIQUE NOT NULL,
  store_name TEXT NOT NULL,
  pic_name TEXT NOT NULL,
  pic_phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postcode TEXT NOT NULL,
  store_type TEXT NOT NULL CHECK (store_type IN (
    'barbershop', 'shoe_store', 'fashion_boutique', 'sports_store',
    'laundromat', 'gym', 'muslim_fashion', 'school_uniform',
    'pharmacy', 'optical', 'cafe', 'other'
  )),
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  commission_rate DECIMAL(5,2) DEFAULT 30.00,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'pending')),
  performance_score DECIMAL(5,2) DEFAULT 0,
  consecutive_low_months INTEGER DEFAULT 0,
  qr_code_ref TEXT UNIQUE NOT NULL,
  agreement_signed_at TIMESTAMPTZ,
  agreement_signed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'ops_manager', 'store_owner')),
  store_id UUID REFERENCES public.stores(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('ankle', 'crew', 'no_show', 'half', 'kids', 'muslimah', 'design')),
  color TEXT NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  cost_price DECIMAL(10,2) NOT NULL,
  is_core_sku BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  barcode TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.store_inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.stores(id) NOT NULL,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  restock_threshold INTEGER NOT NULL DEFAULT 6,
  last_restocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, product_id)
);

CREATE TABLE public.stock_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.stores(id) NOT NULL,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'inbound_initial', 'inbound_restock', 'outbound_sale',
    'outbound_return', 'adjustment_add', 'adjustment_remove'
  )),
  quantity INTEGER NOT NULL,
  reference_id UUID,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.stores(id) NOT NULL,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  commission_amount DECIMAL(10,2) NOT NULL,
  xocks_revenue DECIMAL(10,2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('qr', 'cash')),
  qr_reference TEXT,
  recorded_by UUID REFERENCES public.profiles(id),
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.restock_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.stores(id) NOT NULL,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  current_quantity INTEGER NOT NULL,
  threshold_quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'fulfilled', 'dismissed')),
  acknowledged_by UUID REFERENCES public.profiles(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.restock_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.stores(id) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'dispatched', 'received'
  )),
  requested_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.restock_request_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restock_request_id UUID REFERENCES public.restock_requests(id) NOT NULL,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  quantity_requested INTEGER NOT NULL,
  quantity_approved INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.delivery_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  do_number TEXT UNIQUE NOT NULL,
  store_id UUID REFERENCES public.stores(id) NOT NULL,
  restock_request_id UUID REFERENCES public.restock_requests(id),
  do_type TEXT NOT NULL CHECK (do_type IN ('initial', 'restock', 'return')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'confirmed', 'dispatched', 'delivered', 'acknowledged'
  )),
  dispatch_date DATE,
  delivery_date DATE,
  tracking_number TEXT,
  courier TEXT,
  total_pairs INTEGER NOT NULL DEFAULT 0,
  pdf_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.delivery_order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_order_id UUID REFERENCES public.delivery_orders(id) NOT NULL,
  product_id UUID REFERENCES public.products(id) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.commission_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.stores(id) NOT NULL,
  period_month INTEGER NOT NULL,
  period_year INTEGER NOT NULL,
  total_units_sold INTEGER NOT NULL DEFAULT 0,
  total_revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
  commission_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  xocks_revenue DECIMAL(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'disputed')),
  pdf_url TEXT,
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, period_month, period_year)
);

CREATE TABLE public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_role TEXT CHECK (recipient_role IN ('super_admin', 'ops_manager', 'store_owner')),
  recipient_store_id UUID REFERENCES public.stores(id),
  type TEXT NOT NULL CHECK (type IN (
    'low_stock_alert', 'restock_request', 'do_dispatched',
    'do_delivered', 'commission_ready', 'commission_paid',
    'performance_warning', 'new_store_added'
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reference_id UUID,
  reference_type TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Default settings ──────────────────────────────────────────────────────────

INSERT INTO public.settings (key, value, description) VALUES
('default_commission_rate', '30', 'Default commission % for new stores'),
('restock_threshold_default', '6', 'Pairs remaining before low stock alert'),
('starter_pack_quantity', '24', 'Default pairs in a starter pack'),
('min_restock_quantity', '12', 'Minimum pairs per restock order'),
('performance_score_threshold', '20', 'Monthly sell-through % below which is flagged'),
('consecutive_warning_months', '2', 'Months below threshold before warning'),
('consecutive_suspend_months', '3', 'Months below threshold before flag for recall'),
('company_name', 'Wayne Group Holding Sdn Bhd', 'Legal company name'),
('company_address', 'Cheras, Kuala Lumpur', 'Company address for DO headers'),
('company_phone', '', 'Company phone for documents'),
('company_email', 'info@xocks.co', 'Company email for documents'),
('company_reg_number', '', 'SSM registration number');

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_sales_store_date ON sales(store_id, sale_date);
CREATE INDEX idx_store_inventory_store ON store_inventory(store_id);
CREATE INDEX idx_stock_movements_store ON stock_movements(store_id, created_at);
CREATE INDEX idx_notifications_role ON notifications(recipient_role, is_read);
CREATE INDEX idx_notifications_store ON notifications(recipient_store_id, is_read);
CREATE INDEX idx_restock_alerts_store ON restock_alerts(store_id, status);
CREATE INDEX idx_delivery_orders_store ON delivery_orders(store_id, status);
CREATE INDEX idx_commission_periods_store ON commission_periods(store_id, period_year, period_month);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restock_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restock_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to get current user store_id
CREATE OR REPLACE FUNCTION public.get_user_store_id()
RETURNS UUID AS $$
  SELECT store_id FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Profiles
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR get_user_role() IN ('super_admin', 'ops_manager'));

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Admins can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (get_user_role() IN ('super_admin', 'ops_manager'));

-- Stores
CREATE POLICY "Store owners see own store" ON public.stores
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    id = get_user_store_id()
  );

CREATE POLICY "Admins manage stores" ON public.stores
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Products
CREATE POLICY "All authenticated users can view active products" ON public.products
  FOR SELECT USING (auth.uid() IS NOT NULL AND (is_active = true OR get_user_role() IN ('super_admin', 'ops_manager')));

CREATE POLICY "Admins manage products" ON public.products
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Store Inventory
CREATE POLICY "Store owners see own inventory" ON public.store_inventory
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Admins manage inventory" ON public.store_inventory
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Stock movements
CREATE POLICY "Store owners see own movements" ON public.stock_movements
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Store owners insert movements" ON public.stock_movements
  FOR INSERT WITH CHECK (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Admins manage movements" ON public.stock_movements
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Sales
CREATE POLICY "Store owners see own sales" ON public.sales
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Store owners insert sales" ON public.sales
  FOR INSERT WITH CHECK (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Admins manage sales" ON public.sales
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Restock alerts
CREATE POLICY "Store owners see own alerts" ON public.restock_alerts
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Admins manage alerts" ON public.restock_alerts
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

CREATE POLICY "Anyone can insert alerts" ON public.restock_alerts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Restock requests
CREATE POLICY "Store owners see own requests" ON public.restock_requests
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Store owners insert requests" ON public.restock_requests
  FOR INSERT WITH CHECK (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Admins manage requests" ON public.restock_requests
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Restock request items
CREATE POLICY "Users see items of accessible requests" ON public.restock_request_items
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    (SELECT store_id FROM public.restock_requests WHERE id = restock_request_id) = get_user_store_id()
  );

CREATE POLICY "Insert items for accessible requests" ON public.restock_request_items
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage request items" ON public.restock_request_items
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Delivery orders
CREATE POLICY "Store owners see own DOs" ON public.delivery_orders
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Admins manage DOs" ON public.delivery_orders
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Delivery order items
CREATE POLICY "Users see items of accessible DOs" ON public.delivery_order_items
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    (SELECT store_id FROM public.delivery_orders WHERE id = delivery_order_id) = get_user_store_id()
  );

CREATE POLICY "Admins manage DO items" ON public.delivery_order_items
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Commission periods
CREATE POLICY "Store owners see own commissions" ON public.commission_periods
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    store_id = get_user_store_id()
  );

CREATE POLICY "Admins manage commissions" ON public.commission_periods
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Notifications
CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT USING (
    get_user_role() IN ('super_admin', 'ops_manager') AND recipient_role IN ('super_admin', 'ops_manager') OR
    recipient_store_id = get_user_store_id() OR
    recipient_role = get_user_role()
  );

CREATE POLICY "System inserts notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE USING (
    get_user_role() IN ('super_admin', 'ops_manager') OR
    recipient_store_id = get_user_store_id()
  );

-- Settings
CREATE POLICY "Admins manage settings" ON public.settings
  FOR ALL USING (get_user_role() IN ('super_admin', 'ops_manager'));

CREATE POLICY "All authenticated can read settings" ON public.settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Enable in Supabase Dashboard > Database > Replication for these tables:
-- notifications, sales, restock_alerts
