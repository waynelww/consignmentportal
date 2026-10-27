-- Restock Calculator (Wayne's consignment restock method).
-- Every per-store calculation is saved here so history can be pulled later.
-- Rows are append-only: results are frozen at insert; only the edited Send
-- numbers, the linked restock request and the void fields may change, a
-- voided row cannot change at all, and rows can never be deleted.

CREATE TABLE IF NOT EXISTS public.restock_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  store_code TEXT NOT NULL,                     -- snapshot at calculation time
  store_name TEXT NOT NULL,                     -- snapshot at calculation time
  end_month TEXT NOT NULL CHECK (end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  settings JSONB NOT NULL,                      -- prices, multipliers, thresholds used
  status TEXT NOT NULL CHECK (status IN ('restock_now','stock_ok','not_enough_history')),
  months JSONB NOT NULL DEFAULT '[]'::jsonb,    -- per-month sales amount, pairs, deviation
  pairs_per_month NUMERIC(10,1),
  target_stock INTEGER,
  restock_trigger INTEGER,
  on_hand INTEGER NOT NULL DEFAULT 0,
  pairs_to_send INTEGER,                        -- calculated total
  consistency_flag BOOLEAN NOT NULL DEFAULT false,
  first_sale_date DATE,
  last_sale_date DATE,
  stale_sales BOOLEAN NOT NULL DEFAULT false,
  sku_results JSONB NOT NULL DEFAULT '[]'::jsonb,           -- per-SKU calculated results
  sold_not_in_inventory JSONB NOT NULL DEFAULT '[]'::jsonb, -- info note only
  edited_sends JSONB,                           -- { product_id: qty } where the user overrode Send
  final_total INTEGER,                          -- total pairs after edits
  restock_request_id UUID,                      -- restock request created from this calculation
  calculated_by UUID NOT NULL,                  -- auth user id (logged-in user)
  calculated_by_name TEXT,                      -- snapshot of profiles.full_name
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_by UUID,
  edited_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  void_reason TEXT,
  CONSTRAINT restock_calculations_void_reason CHECK (
    voided_at IS NULL OR (voided_by IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_restock_calculations_store
  ON public.restock_calculations (store_id, calculated_at DESC);

-- Append-only guard (applies to every role, including the service key).
CREATE OR REPLACE FUNCTION public.restock_calculations_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'restock_calculations rows cannot be deleted; void them with a reason instead';
  END IF;

  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'restock calculation % is voided and cannot be changed', OLD.id;
  END IF;

  IF (NEW.id, NEW.store_id, NEW.store_code, NEW.store_name, NEW.end_month, NEW.period_start,
      NEW.period_end, NEW.settings, NEW.status, NEW.months, NEW.pairs_per_month,
      NEW.target_stock, NEW.restock_trigger, NEW.on_hand, NEW.pairs_to_send,
      NEW.consistency_flag, NEW.first_sale_date, NEW.last_sale_date, NEW.stale_sales,
      NEW.sku_results, NEW.sold_not_in_inventory, NEW.calculated_by,
      NEW.calculated_by_name, NEW.calculated_at)
     IS DISTINCT FROM
     (OLD.id, OLD.store_id, OLD.store_code, OLD.store_name, OLD.end_month, OLD.period_start,
      OLD.period_end, OLD.settings, OLD.status, OLD.months, OLD.pairs_per_month,
      OLD.target_stock, OLD.restock_trigger, OLD.on_hand, OLD.pairs_to_send,
      OLD.consistency_flag, OLD.first_sale_date, OLD.last_sale_date, OLD.stale_sales,
      OLD.sku_results, OLD.sold_not_in_inventory, OLD.calculated_by,
      OLD.calculated_by_name, OLD.calculated_at) THEN
    RAISE EXCEPTION 'calculated results of restock calculation % are read-only', OLD.id;
  END IF;

  IF OLD.restock_request_id IS NOT NULL
     AND NEW.restock_request_id IS DISTINCT FROM OLD.restock_request_id THEN
    RAISE EXCEPTION 'restock calculation % is already linked to a restock request', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restock_calculations_guard ON public.restock_calculations;
CREATE TRIGGER trg_restock_calculations_guard
  BEFORE UPDATE OR DELETE ON public.restock_calculations
  FOR EACH ROW EXECUTE FUNCTION public.restock_calculations_guard();

ALTER TABLE public.restock_calculations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restock_calculations admin select" ON public.restock_calculations;
CREATE POLICY "restock_calculations admin select" ON public.restock_calculations
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));

DROP POLICY IF EXISTS "restock_calculations admin insert" ON public.restock_calculations;
CREATE POLICY "restock_calculations admin insert" ON public.restock_calculations
  FOR INSERT WITH CHECK (get_user_role() IN ('super_admin', 'ops_manager') AND calculated_by = auth.uid());

DROP POLICY IF EXISTS "restock_calculations admin update" ON public.restock_calculations;
CREATE POLICY "restock_calculations admin update" ON public.restock_calculations
  FOR UPDATE USING (get_user_role() IN ('super_admin', 'ops_manager'))
  WITH CHECK (get_user_role() IN ('super_admin', 'ops_manager'));
-- No DELETE policy: deletes are refused (and the trigger blocks them anyway).

-- Editable calculator settings (text values, like the rest of public.settings).
-- ON CONFLICT DO NOTHING: never overwrite a value someone has already edited.
INSERT INTO public.settings (key, value, description) VALUES
  ('restock_calc_price_plain', '13', 'Restock Calculator: RM per pair for Plain Series (sales ÷ price = pairs)'),
  ('restock_calc_price_special', '19', 'Restock Calculator: RM per pair for Special Patches'),
  ('restock_calc_special_min_selling_price', '19', 'Restock Calculator: products with selling price at or above this count as Special Patches'),
  ('restock_calc_target_multiplier', '4', 'Restock Calculator: target stock = pairs per month × this'),
  ('restock_calc_trigger_multiplier', '2', 'Restock Calculator: restock trigger = pairs per month × this'),
  ('restock_calc_consistency_pct', '20', 'Restock Calculator: flag a month more than this % away from the average'),
  ('restock_calc_stale_sale_days', '7', 'Restock Calculator: warn when the last recorded sale is older than this many days')
ON CONFLICT (key) DO NOTHING;
