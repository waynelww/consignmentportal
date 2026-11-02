-- Product barcodes: who set a barcode and when.
--
-- Adds an append-only log of every barcode change made through the admin
-- "Scan to set barcode" action (or the barcode field on the product form), and a
-- function that updates products.barcode and writes the log row in one
-- transaction, so a change can never happen without its log row.
--
-- Additive only: no existing table, column or row is changed or dropped.
-- There is deliberately NO unique index on products.barcode: existing data may
-- hold duplicates. The duplicate warning is enforced by the app, which compares
-- codes with lib/barcode/normalize.ts (UPC-A and EAN-13 with a leading 0 match).

CREATE TABLE IF NOT EXISTS public.product_barcode_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES public.products(id),
  old_barcode         TEXT,
  new_barcode         TEXT NOT NULL,
  set_by              UUID REFERENCES public.profiles(id),
  set_by_name         TEXT NOT NULL,
  -- Set when the admin saved over a code another product already had
  conflict_product_id UUID REFERENCES public.products(id),
  set_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_barcode_log_product
  ON public.product_barcode_log (product_id, set_at DESC);

-- Append-only: any UPDATE or DELETE fails.
CREATE OR REPLACE FUNCTION public.product_barcode_log_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Product barcode history rows cannot be changed or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_product_barcode_log_guard ON public.product_barcode_log;
CREATE TRIGGER trg_product_barcode_log_guard
  BEFORE UPDATE OR DELETE ON public.product_barcode_log
  FOR EACH ROW EXECUTE FUNCTION public.product_barcode_log_append_only_guard();

-- Row level security: admins can read the history. Writes go only through
-- set_product_barcode() via the admin API route (service role).
ALTER TABLE public.product_barcode_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_barcode_log select" ON public.product_barcode_log;
CREATE POLICY "product_barcode_log select" ON public.product_barcode_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'ops_manager')
  ));

-- Sets products.barcode and writes the log row in one transaction.
-- The caller (admin API route) has already checked the role and the duplicate.
CREATE OR REPLACE FUNCTION public.set_product_barcode(
  p_product_id          UUID,
  p_barcode             TEXT,
  p_set_by              UUID,
  p_set_by_name         TEXT,
  p_conflict_product_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_old TEXT;
BEGIN
  SELECT barcode INTO v_old
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.products
  SET barcode = p_barcode, updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO public.product_barcode_log
    (product_id, old_barcode, new_barcode, set_by, set_by_name, conflict_product_id)
  VALUES
    (p_product_id, v_old, p_barcode, p_set_by, p_set_by_name, p_conflict_product_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_barcode(UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_barcode(UUID, TEXT, UUID, TEXT, UUID) TO service_role;
