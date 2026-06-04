-- Indexes that future-proof admin reports as the network grows past ~500 stores.
-- These don't help per-store queries (those already have idx_sales_store_date etc.)
-- but they make network-wide aggregations fast even when sales rows are in the millions.

-- Network-wide date-range queries: "sales between X and Y across all stores"
-- Without this Postgres has to scan the whole table; with it, range scan + bitmap.
CREATE INDEX IF NOT EXISTS idx_sales_sale_date
  ON public.sales(sale_date);

-- Per-SKU performance reports across the network
CREATE INDEX IF NOT EXISTS idx_sales_product_date
  ON public.sales(product_id, sale_date);

-- Admin "pending invoices" / "approved last month" filters
CREATE INDEX IF NOT EXISTS idx_commission_periods_status_year_month
  ON public.commission_periods(status, period_year, period_month);

-- Network-wide DO status filters (e.g. "all in-flight deliveries today")
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status_created
  ON public.delivery_orders(status, created_at DESC);

-- Stock-movement audit by movement type (e.g. "all returns last month")
CREATE INDEX IF NOT EXISTS idx_stock_movements_type_created
  ON public.stock_movements(movement_type, created_at DESC);
