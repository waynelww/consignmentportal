-- Event POS: patches have no stock at events.
--
-- NOT APPLIED automatically. Apply with the Supabase connector's
-- apply_migration after the operator's OK (docs/OPERATOR_HANDBOOK.md, rule 1).
-- Apply it BEFORE (or with) deploying the code that ships with it: the POS
-- then always shows the patch tiles, and without this migration a patch sale
-- would still be stock-checked and fail with "Not enough stock for Patches".
--
-- "(RM4) Per Patches" (SKU "Patches"), "FREE 6 Patches" and "FREE 10 Patches"
-- (both recorded on the Patches product, stock_qty 6 / 10) are too many to
-- count, so they have no event stock. Lines for the patch product (matched by
-- products.sku = 'Patches', any case) now skip, in both functions:
--   * the stock check (pos_record_sale)
--   * the location_stock change (sale: minus; void: plus)
--   * the stock_transfers ledger row ("Event POS sale:" / "Event POS void:")
-- They are still written to pos_sale_items exactly as before (qty, stock_qty =
-- patches given, unit_price), so patch history is kept. Everything else in
-- both functions is identical to 20261127_event_pos.sql. Socks keep the strict
-- event-stock check.
--
-- Note: a patch sale made BEFORE this migration did take stock; voiding it
-- after this migration does not put patch stock back (patches are no longer
-- tracked as stock, so there is nothing to put back to).

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
  -- units this sale needs. Patches (SKU "Patches") have no event stock: no check.
  FOR r IN
    SELECT (i->>'product_id')::uuid AS product_id, MIN(i->>'sku') AS sku, SUM((i->>'stock_qty')::int) AS need
    FROM jsonb_array_elements(p_items) i
    WHERE NOT EXISTS (SELECT 1 FROM products pr WHERE pr.id = (i->>'product_id')::uuid AND upper(btrim(pr.sku)) = 'PATCHES')
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
  -- Patches: no location_stock change and no stock_transfers row.
  FOR r IN
    SELECT (i->>'product_id')::uuid AS product_id, SUM((i->>'stock_qty')::int) AS need
    FROM jsonb_array_elements(p_items) i
    WHERE NOT EXISTS (SELECT 1 FROM products pr WHERE pr.id = (i->>'product_id')::uuid AND upper(btrim(pr.sku)) = 'PATCHES')
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

  -- Patches were never taken from stock, so nothing goes back for them.
  FOR r IN
    SELECT product_id, SUM(stock_qty) AS qty FROM pos_sale_items psi
    WHERE sale_id = p_sale_id
      AND NOT EXISTS (SELECT 1 FROM products pr WHERE pr.id = psi.product_id AND upper(btrim(pr.sku)) = 'PATCHES')
    GROUP BY product_id
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

REVOKE ALL ON FUNCTION public.pos_record_sale(UUID, UUID, TEXT, TEXT, NUMERIC, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_void_sale(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_record_sale(UUID, UUID, TEXT, TEXT, NUMERIC, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_void_sale(UUID, UUID, TEXT) TO service_role;
