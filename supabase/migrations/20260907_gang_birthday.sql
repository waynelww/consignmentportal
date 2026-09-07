-- Collect member birthdays (for birthday promos / remarketing).
ALTER TABLE public.gang_members ADD COLUMN IF NOT EXISTS birthday DATE;
