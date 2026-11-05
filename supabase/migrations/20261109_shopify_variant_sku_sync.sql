-- Keep product SKUs and photos in step with Shopify (lib/shopify/sync-inventory.ts).
--
-- 1. products.shopify_variant_id: the Shopify ProductVariant GID a product is
--    linked to. Set by the sync when it can match a product to exactly one
--    variant (by SKU, else by name). Unique where set, so one Shopify variant
--    can never be linked to two XCMS products.
-- 2. product_sku_changes: append-only history of every SKU change the sync makes
--    (old SKU, new SKU, when, and whether it came from the admin Refresh or the
--    nightly job).
--
-- Additive only: no existing column, row or table is changed or dropped.
-- Existing products stay unlinked (shopify_variant_id NULL) until the next sync.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS shopify_variant_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_shopify_variant_id_key
  ON public.products (shopify_variant_id)
  WHERE shopify_variant_id IS NOT NULL;

COMMENT ON COLUMN public.products.shopify_variant_id IS
  'Shopify ProductVariant GID this product is linked to (set by the Shopify sync; unique where set)';

CREATE TABLE IF NOT EXISTS public.product_sku_changes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES public.products(id),
  old_sku     TEXT NOT NULL,
  new_sku     TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'refresh' = admin "Refresh from Shopify"; 'nightly' = sync-shopify-inventory cron
  source      TEXT NOT NULL CHECK (source IN ('refresh', 'nightly'))
);

CREATE INDEX IF NOT EXISTS idx_product_sku_changes_product
  ON public.product_sku_changes (product_id, changed_at DESC);

-- Append-only: any UPDATE or DELETE fails.
CREATE OR REPLACE FUNCTION public.product_sku_changes_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Product SKU history rows cannot be changed or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_product_sku_changes_guard ON public.product_sku_changes;
CREATE TRIGGER trg_product_sku_changes_guard
  BEFORE UPDATE OR DELETE ON public.product_sku_changes
  FOR EACH ROW EXECUTE FUNCTION public.product_sku_changes_append_only_guard();

-- Row level security: admins can read the history. Writes go only through
-- apply_product_sku_change() via the service role (the sync).
ALTER TABLE public.product_sku_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_sku_changes select" ON public.product_sku_changes;
CREATE POLICY "product_sku_changes select" ON public.product_sku_changes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'ops_manager')
  ));

-- Changes products.sku and writes the history row in one transaction, so a SKU
-- can never change without its log row. A duplicate SKU raises 23505 (unique
-- violation); the sync reports that as a conflict and carries on.
CREATE OR REPLACE FUNCTION public.apply_product_sku_change(
  p_product_id UUID,
  p_new_sku    TEXT,
  p_source     TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_old TEXT;
BEGIN
  SELECT sku INTO v_old
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_old = p_new_sku THEN
    RETURN;
  END IF;

  UPDATE public.products
  SET sku = p_new_sku, updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO public.product_sku_changes (product_id, old_sku, new_sku, source)
  VALUES (p_product_id, v_old, p_new_sku, p_source);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_product_sku_change(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_product_sku_change(UUID, TEXT, TEXT) TO service_role;
