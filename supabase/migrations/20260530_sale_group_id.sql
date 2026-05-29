-- Add sale_group_id to group multi-item transactions
-- A single transaction can produce multiple sale rows (one per product) sharing the same sale_group_id
-- Single-product sales leave it NULL

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_sales_sale_group_id
  ON public.sales (sale_group_id)
  WHERE sale_group_id IS NOT NULL;

-- Backfill: group existing rows that were created within 2 seconds of each other
-- by the same recorder for the same store. These were likely from the same batch.
WITH grouped AS (
  SELECT
    id,
    store_id,
    recorded_by,
    DATE_TRUNC('second', created_at) AS group_key,
    -- assign a uuid per (store_id, recorded_by, 2-second bucket)
    MD5(CONCAT(store_id::text, recorded_by::text, FLOOR(EXTRACT(EPOCH FROM created_at) / 2)::text))::uuid AS group_uuid,
    COUNT(*) OVER (
      PARTITION BY store_id, recorded_by, FLOOR(EXTRACT(EPOCH FROM created_at) / 2)
    ) AS group_size
  FROM public.sales
  WHERE sale_group_id IS NULL
)
UPDATE public.sales s
SET sale_group_id = g.group_uuid
FROM grouped g
WHERE s.id = g.id AND g.group_size > 1;
