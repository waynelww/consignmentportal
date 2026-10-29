-- Low-stock rework: per-store pairs-per-code, per-code override, 4-month plan.
--
-- Stocked level for a code:
--   * store on the 4-month plan (avg monthly sales >= RM250): store_inventory.plan_level
--   * otherwise: store_inventory.stocked_level (admin override, source 'manual')
--                if set, else stores.pairs_per_code
-- Low when quantity_on_hand <= max(1, stocked level x low_stock_pct / 100); out at 0.
--
-- Additive only: restock_threshold is no longer read and can be dropped in a
-- later migration. No rows are deleted. Nothing here reads delivery orders
-- except the one-off backfill of stores.pairs_per_code below.

-- ── Stores ───────────────────────────────────────────────────────────────────
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS pairs_per_code INTEGER NOT NULL DEFAULT 3 CHECK (pairs_per_code >= 1),
  ADD COLUMN IF NOT EXISTS on_stock_plan BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avg_monthly_sales NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- Backfill: the most common quantity across each store's initial DO items
-- (ties go to the larger quantity). Stores with no initial DO keep the default 3.
WITH per_store AS (
  SELECT d.store_id, i.quantity, count(*) AS n
  FROM public.delivery_order_items i
  JOIN public.delivery_orders d ON d.id = i.delivery_order_id
  WHERE d.do_type = 'initial' AND i.quantity > 0
  GROUP BY d.store_id, i.quantity
),
mode_per_store AS (
  SELECT DISTINCT ON (store_id) store_id, quantity
  FROM per_store
  ORDER BY store_id, n DESC, quantity DESC
)
UPDATE public.stores s
SET pairs_per_code = m.quantity
FROM mode_per_store m
WHERE m.store_id = s.id;

-- ── Store inventory ──────────────────────────────────────────────────────────
ALTER TABLE public.store_inventory
  ADD COLUMN IF NOT EXISTS stocked_level INTEGER CHECK (stocked_level >= 0),
  ADD COLUMN IF NOT EXISTS stocked_level_source TEXT CHECK (stocked_level_source IN ('manual')),
  ADD COLUMN IF NOT EXISTS plan_level INTEGER CHECK (plan_level >= 0),
  ADD COLUMN IF NOT EXISTS plan_level_updated_at TIMESTAMPTZ;

ALTER TABLE public.store_inventory
  DROP CONSTRAINT IF EXISTS store_inventory_stocked_level_source_pair;
ALTER TABLE public.store_inventory
  ADD CONSTRAINT store_inventory_stocked_level_source_pair
  CHECK ((stocked_level IS NULL) = (stocked_level_source IS NULL));

-- ── Settings ─────────────────────────────────────────────────────────────────
INSERT INTO public.settings (key, value, description) VALUES
  ('restock_plan_min_monthly_sales', '250', 'Average monthly sales (RM) at or above which a store uses the 4-month stock plan'),
  ('restock_plan_avg_months', '3', 'Months averaged for the 4-month plan sales threshold (2 or 3)'),
  ('low_stock_pct', '50', 'Code is low when on hand <= stocked level x this % (never below 1 pair)'),
  ('low_stock_alert_email', 'vaernandbk@gmail.com', 'Recipient of the daily 9am MYT low-stock summary email')
ON CONFLICT (key) DO NOTHING;
