-- Event POS (phone point-of-sale for booth events) + Event Targets merged
-- into Events.
--
-- What this adds:
--   1. event_targets.event_id — one Event Target per event (nullable, unique).
--   2. event_target_settings.profit_unlock_amount — bonuses stay locked until
--      event profit (POS sales − the target's fixed_cost) reaches this.
--   3. pos_staff (one row per part-timer, reused across events),
--      pos_staff_pins (server-only PIN hashes), event_staff (who sells at
--      which event; hidden = not shown on the POS, sales kept).
--   4. pos_discounts — rule-based discounts (event_id NULL = global),
--      seeded with the standard global list.
--   5. pos_sales / pos_sale_items / pos_sale_audit — the sales ledger.
--   6. pos_record_sale / pos_void_sale / pos_recalc_bonus — the only write
--      paths for sales. Each runs in ONE transaction, locks the event row
--      (so two phones can't both claim the profit-crossing sale or oversell
--      stock), and moves stock through location_stock + stock_transfers.
--
-- Every table here: RLS on, no policies, revoked from anon/authenticated.
-- All access is through the API with the service role (admin routes check
-- super_admin/ops_manager; /api/pos/* checks the signed POS session).
-- The functions are executable by service_role only.

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.event_targets
  ADD COLUMN IF NOT EXISTS event_id UUID UNIQUE REFERENCES public.events(id) ON DELETE SET NULL;

-- 2 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.event_target_settings
  ADD COLUMN IF NOT EXISTS profit_unlock_amount NUMERIC(10,2) NOT NULL DEFAULT 1000;

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_staff_name ON public.pos_staff (lower(name));

CREATE TABLE IF NOT EXISTS public.pos_staff_pins (
  staff_id UUID PRIMARY KEY REFERENCES public.pos_staff(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_staff (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.pos_staff(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hidden BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (event_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_event_staff_staff ON public.event_staff (staff_id);

-- 4 ─────────────────────────────────────────────────────────────────────────
-- type / params (amounts in RM, "pairs" = socks only, add-ons never count):
--   free_cheapest      {min_pairs, free}          cheapest `free` pairs free
--   percent            {pct}                       % off the whole cart
--   free_then_percent  {min_pairs, free, pct}      cheapest free, then % off the rest
--   bundle_price       {pairs, price}              cheapest `pairs` pairs for RM price
--   group_percent      {group, pct}                % off one group (e.g. design)
--   addon_free         {patches}                   cheapest N paid patches free
--   per_pair_off       {amount, unit_price}        RM off every pair priced unit_price
-- code is for promo codes later (unused for now).
CREATE TABLE IF NOT EXISTS public.pos_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  code TEXT,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'free_cheapest', 'percent', 'free_then_percent', 'bundle_price',
    'group_percent', 'addon_free', 'per_pair_off'
  )),
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_discounts_event ON public.pos_discounts (event_id, sort);

INSERT INTO public.pos_discounts (label, type, params, sort)
SELECT v.label, v.type, v.params::jsonb, v.sort
FROM (VALUES
  ('BUY 4 FREE 1',          'free_cheapest',     '{"min_pairs":5,"free":1}',          10),
  ('FREE SOCKS',            'free_cheapest',     '{"min_pairs":1,"free":1}',          20),
  ('8% OFF',                'percent',           '{"pct":8}',                         30),
  ('5% OFF',                'percent',           '{"pct":5}',                         40),
  ('B4F1 + 5%',             'free_then_percent', '{"min_pairs":5,"free":1,"pct":5}',  50),
  ('10% OFF',               'percent',           '{"pct":10}',                        60),
  ('B4F1 + 8%',             'free_then_percent', '{"min_pairs":5,"free":1,"pct":8}',  70),
  ('B5F2 + 10%',            'free_then_percent', '{"min_pairs":7,"free":2,"pct":10}', 80),
  ('B5F2 + 8%',             'free_then_percent', '{"min_pairs":7,"free":2,"pct":8}',  90),
  ('B4F1 + 10%',            'free_then_percent', '{"min_pairs":5,"free":1,"pct":10}', 100),
  ('Buy 1 RM5.99',          'bundle_price',      '{"pairs":1,"price":5.99}',          110),
  ('Buy 1 Free 1',          'free_cheapest',     '{"min_pairs":2,"free":1}',          120),
  ('50% OFF Design Socks',  'group_percent',     '{"group":"design","pct":50}',       130),
  ('Buy 3 Free 1',          'free_cheapest',     '{"min_pairs":4,"free":1}',          140),
  ('Buy 2 RM24.99',         'bundle_price',      '{"pairs":2,"price":24.99}',         150),
  ('Buy 2 Free 1',          'free_cheapest',     '{"min_pairs":3,"free":1}',          160),
  ('Buy 3 at RM37.99',      'bundle_price',      '{"pairs":3,"price":37.99}',         170),
  ('Buy 3 Free 3',          'free_cheapest',     '{"min_pairs":6,"free":3}',          180),
  ('Free 1 Set Patch',      'addon_free',        '{"patches":2}',                     190),
  ('RM11.99 per pair',      'per_pair_off',      '{"amount":2,"unit_price":13.99}',   200),
  ('B5F2',                  'free_cheapest',     '{"min_pairs":7,"free":2}',          210)
) AS v(label, type, params, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM public.pos_discounts d WHERE d.event_id IS NULL AND d.label = v.label
);

-- 5 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id),
  sale_no INTEGER NOT NULL,                         -- 1, 2, 3 … per event
  staff_id UUID NOT NULL REFERENCES public.pos_staff(id),
  event_day DATE NOT NULL,                          -- Malaysia date of the sale
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'qr')),
  subtotal NUMERIC(10,2) NOT NULL,
  discount_id UUID REFERENCES public.pos_discounts(id) ON DELETE SET NULL,
  discount_label TEXT,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  cash_received NUMERIC(10,2),
  change NUMERIC(10,2),
  bonus_eligible_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES public.profiles(id),
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, sale_no)
);
CREATE INDEX IF NOT EXISTS idx_pos_sales_event ON public.pos_sales (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_sales_staff ON public.pos_sales (event_id, staff_id, event_day);

-- qty = items sold on the line; stock_qty = units taken from event stock
-- (equal for normal items; "FREE 6 Patches" is qty 1, stock_qty 6).
CREATE TABLE IF NOT EXISTS public.pos_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  stock_qty INTEGER NOT NULL CHECK (stock_qty > 0),
  unit_price NUMERIC(10,2) NOT NULL,
  is_pair BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale ON public.pos_sale_items (sale_id);

CREATE TABLE IF NOT EXISTS public.pos_sale_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id),
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_staff_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_staff, public.pos_staff_pins, public.event_staff, public.pos_discounts,
  public.pos_sales, public.pos_sale_items, public.pos_sale_audit FROM anon, authenticated;

-- 6 ─────────────────────────────────────────────────────────────────────────

-- Recompute bonus_eligible_amount for every sale of an event, in sale order.
-- Threshold = target fixed_cost + profit_unlock_amount; only the part of the
-- running total above it counts. No Event Target saved → bonuses off (0).
-- Caller should hold the event row lock (the functions below do).
CREATE OR REPLACE FUNCTION public.pos_recalc_bonus(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_fixed NUMERIC;
  v_unlock NUMERIC;
  v_threshold NUMERIC;
  v_running NUMERIC := 0;
  r RECORD;
BEGIN
  PERFORM 1 FROM events WHERE id = p_event_id FOR UPDATE;

  SELECT fixed_cost INTO v_fixed FROM event_targets WHERE event_id = p_event_id;
  SELECT COALESCE(profit_unlock_amount, 1000) INTO v_unlock FROM event_target_settings WHERE id = 1;
  v_unlock := COALESCE(v_unlock, 1000);

  IF v_fixed IS NULL THEN
    UPDATE pos_sales SET bonus_eligible_amount = 0
    WHERE event_id = p_event_id AND bonus_eligible_amount <> 0;
    RETURN;
  END IF;

  v_threshold := v_fixed + v_unlock;
  UPDATE pos_sales SET bonus_eligible_amount = 0
  WHERE event_id = p_event_id AND voided_at IS NOT NULL AND bonus_eligible_amount <> 0;

  FOR r IN
    SELECT id, total, bonus_eligible_amount FROM pos_sales
    WHERE event_id = p_event_id AND voided_at IS NULL
    ORDER BY created_at, sale_no
  LOOP
    DECLARE
      v_elig NUMERIC := GREATEST(0, LEAST(r.total, v_running + r.total - v_threshold));
    BEGIN
      IF v_elig <> r.bonus_eligible_amount THEN
        UPDATE pos_sales SET bonus_eligible_amount = v_elig WHERE id = r.id;
      END IF;
      v_running := v_running + r.total;
    END;
  END LOOP;
END;
$$;

-- Record one POS sale. Prices and the discount are calculated by the API
-- from the database before calling this; this function makes it atomic:
-- idempotency, event still active, staff on this event, stock at the event
-- location, sale number, bonus eligibility, items, stock movement + ledger.
-- p_items: [{product_id, sku, name, qty, stock_qty, unit_price, is_pair}]
-- Errors are raised as 'POS:<CODE>:<detail>' for the API to translate.
CREATE OR REPLACE FUNCTION public.pos_record_sale(
  p_event_id UUID,
  p_staff_id UUID,
  p_idempotency_key TEXT,
  p_payment_method TEXT,
  p_subtotal NUMERIC,
  p_discount_id UUID,
  p_discount_label TEXT,
  p_discount_amount NUMERIC,
  p_total NUMERIC,
  p_cash_received NUMERIC,
  p_change NUMERIC,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_existing RECORD;
  v_sale_id UUID;
  v_sale_no INTEGER;
  v_day DATE := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_fixed NUMERIC;
  v_unlock NUMERIC;
  v_prior NUMERIC;
  v_elig NUMERIC := 0;
  v_have INTEGER;
  r RECORD;
BEGIN
  SELECT id, name, status, stock_location_id INTO v_event
  FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.stock_location_id IS NULL THEN
    RAISE EXCEPTION 'POS:EVENT_NOT_FOUND:';
  END IF;

  -- Checked after the lock so a double tap waits, then sees the first sale.
  SELECT id, sale_no, total INTO v_existing FROM pos_sales WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('sale_id', v_existing.id, 'sale_no', v_existing.sale_no,
                              'total', v_existing.total, 'duplicate', true);
  END IF;

  IF v_event.status <> 'active' THEN
    RAISE EXCEPTION 'POS:EVENT_CLOSED:';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM event_staff WHERE event_id = p_event_id AND staff_id = p_staff_id AND NOT hidden) THEN
    RAISE EXCEPTION 'POS:STAFF_NOT_ON_EVENT:';
  END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'POS:EMPTY_CART:';
  END IF;

  -- Stock check: lock each product's event stock row, compare to the total
  -- units this sale needs.
  FOR r IN
    SELECT (i->>'product_id')::uuid AS product_id, MIN(i->>'sku') AS sku, SUM((i->>'stock_qty')::int) AS need
    FROM jsonb_array_elements(p_items) i
    GROUP BY 1
  LOOP
    SELECT quantity INTO v_have FROM location_stock
    WHERE location_id = v_event.stock_location_id AND product_id = r.product_id
    FOR UPDATE;
    IF COALESCE(v_have, 0) < r.need THEN
      RAISE EXCEPTION 'POS:INSUFFICIENT_STOCK:%:%', r.sku, COALESCE(v_have, 0);
    END IF;
  END LOOP;

  SELECT COALESCE(MAX(sale_no), 0) + 1 INTO v_sale_no FROM pos_sales WHERE event_id = p_event_id;

  -- Bonus eligibility (see pos_recalc_bonus for the rule).
  SELECT fixed_cost INTO v_fixed FROM event_targets WHERE event_id = p_event_id;
  IF v_fixed IS NOT NULL THEN
    SELECT COALESCE(profit_unlock_amount, 1000) INTO v_unlock FROM event_target_settings WHERE id = 1;
    v_unlock := COALESCE(v_unlock, 1000);
    SELECT COALESCE(SUM(total), 0) INTO v_prior FROM pos_sales WHERE event_id = p_event_id AND voided_at IS NULL;
    v_elig := GREATEST(0, LEAST(p_total, v_prior + p_total - (v_fixed + v_unlock)));
  END IF;

  INSERT INTO pos_sales (
    event_id, sale_no, staff_id, event_day, payment_method, subtotal, discount_id, discount_label,
    discount_amount, total, cash_received, change, bonus_eligible_amount, idempotency_key
  ) VALUES (
    p_event_id, v_sale_no, p_staff_id, v_day, p_payment_method, p_subtotal, p_discount_id, p_discount_label,
    p_discount_amount, p_total, p_cash_received, p_change, v_elig, p_idempotency_key
  ) RETURNING id INTO v_sale_id;

  INSERT INTO pos_sale_items (sale_id, product_id, sku, name, qty, stock_qty, unit_price, is_pair)
  SELECT v_sale_id, (i->>'product_id')::uuid, i->>'sku', i->>'name', (i->>'qty')::int,
         (i->>'stock_qty')::int, (i->>'unit_price')::numeric, COALESCE((i->>'is_pair')::boolean, true)
  FROM jsonb_array_elements(p_items) i;

  -- Stock out of the event location, one ledger row per product.
  FOR r IN
    SELECT (i->>'product_id')::uuid AS product_id, SUM((i->>'stock_qty')::int) AS need
    FROM jsonb_array_elements(p_items) i
    GROUP BY 1
  LOOP
    UPDATE location_stock SET quantity = quantity - r.need, updated_at = now()
    WHERE location_id = v_event.stock_location_id AND product_id = r.product_id;
    INSERT INTO stock_transfers (product_id, quantity, from_location_id, to_location_id, reason, created_by)
    VALUES (r.product_id, r.need, v_event.stock_location_id, NULL,
            'Event POS sale: ' || v_event.name || ' #' || v_sale_no, NULL);
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_no', v_sale_no, 'total', p_total, 'duplicate', false);
END;
$$;

-- Void a sale: mark it, put the stock back into the event location (ledger
-- row "Event POS void: …"), keep an audit row, recalc bonus eligibility for
-- the event. Only while the event is active.
CREATE OR REPLACE FUNCTION public.pos_void_sale(p_sale_id UUID, p_actor UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_event RECORD;
  r RECORD;
BEGIN
  SELECT id, event_id INTO v_sale FROM pos_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'POS:SALE_NOT_FOUND:'; END IF;

  SELECT id, name, status, stock_location_id INTO v_event FROM events WHERE id = v_sale.event_id FOR UPDATE;
  IF v_event.status <> 'active' THEN RAISE EXCEPTION 'POS:EVENT_CLOSED:'; END IF;

  SELECT id, event_id, sale_no, voided_at, total INTO v_sale FROM pos_sales WHERE id = p_sale_id FOR UPDATE;
  IF v_sale.voided_at IS NOT NULL THEN RAISE EXCEPTION 'POS:ALREADY_VOIDED:'; END IF;

  UPDATE pos_sales SET voided_at = now(), voided_by = p_actor, void_reason = p_reason, bonus_eligible_amount = 0
  WHERE id = p_sale_id;

  FOR r IN
    SELECT product_id, SUM(stock_qty) AS qty FROM pos_sale_items WHERE sale_id = p_sale_id GROUP BY product_id
  LOOP
    INSERT INTO location_stock (location_id, product_id, quantity, updated_at)
    VALUES (v_event.stock_location_id, r.product_id, r.qty, now())
    ON CONFLICT (location_id, product_id)
    DO UPDATE SET quantity = location_stock.quantity + EXCLUDED.quantity, updated_at = now();
    INSERT INTO stock_transfers (product_id, quantity, from_location_id, to_location_id, reason, created_by)
    VALUES (r.product_id, r.qty, NULL, v_event.stock_location_id,
            'Event POS void: ' || v_event.name || ' #' || v_sale.sale_no, p_actor);
  END LOOP;

  INSERT INTO pos_sale_audit (sale_id, action, actor_id, reason, details)
  VALUES (p_sale_id, 'void', p_actor, p_reason, jsonb_build_object('total', v_sale.total, 'sale_no', v_sale.sale_no));

  PERFORM pos_recalc_bonus(v_sale.event_id);

  RETURN jsonb_build_object('ok', true, 'sale_no', v_sale.sale_no);
END;
$$;

REVOKE ALL ON FUNCTION public.pos_recalc_bonus(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_record_sale(UUID, UUID, TEXT, TEXT, NUMERIC, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_void_sale(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_recalc_bonus(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_record_sale(UUID, UUID, TEXT, TEXT, NUMERIC, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_void_sale(UUID, UUID, TEXT) TO service_role;
