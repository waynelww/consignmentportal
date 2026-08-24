-- The registration flow now captures phone+name first (auto-saved
-- immediately) and email as a separate later step, so a member can exist
-- before their email is known.
ALTER TABLE public.gang_members ALTER COLUMN email DROP NOT NULL;

-- Xocks only sells through Shopee, TikTok Shop, and the website now —
-- Instagram/in-store dropped from the platform options.
ALTER TABLE public.gang_order_submissions DROP CONSTRAINT IF EXISTS gang_order_submissions_platform_check;
ALTER TABLE public.gang_order_submissions ADD CONSTRAINT gang_order_submissions_platform_check
  CHECK (platform IN ('shopee', 'tiktok', 'website'));
