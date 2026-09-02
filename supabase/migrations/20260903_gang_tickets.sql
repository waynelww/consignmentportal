-- Lucky-draw ticket numbers for Xocks Gang.
--
-- Every VERIFIED order submission gets a sequential ticket number within
-- its draw month (e.g. ticket #0042 of 2026-09). The team announces the
-- winning numbers at the end of each month; a member whose number is
-- called shows their ticket to claim, and the submissions table maps the
-- number straight back to who they are (member -> name/phone).
ALTER TABLE public.gang_order_submissions ADD COLUMN IF NOT EXISTS ticket_no INTEGER;
ALTER TABLE public.gang_order_submissions ADD COLUMN IF NOT EXISTS draw_month TEXT;

-- One number per month, no duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gang_ticket_per_month
  ON public.gang_order_submissions(draw_month, ticket_no)
  WHERE ticket_no IS NOT NULL;

-- Backfill: every already-verified submission gets a ticket in the month
-- it was verified, numbered in verification order.
WITH numbered AS (
  SELECT
    id,
    to_char(COALESCE(verified_at, created_at) AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM') AS dm,
    ROW_NUMBER() OVER (
      PARTITION BY to_char(COALESCE(verified_at, created_at) AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM')
      ORDER BY COALESCE(verified_at, created_at)
    ) AS rn
  FROM public.gang_order_submissions
  WHERE status = 'valid' AND ticket_no IS NULL
)
UPDATE public.gang_order_submissions s
SET ticket_no = n.rn, draw_month = n.dm
FROM numbered n
WHERE s.id = n.id;
