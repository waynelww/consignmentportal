-- Manageable store types: admin can add/edit/disable without code changes.

CREATE TABLE IF NOT EXISTS public.store_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  value TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_types_sort ON public.store_types(sort_order, label);

-- Seed with current values
INSERT INTO public.store_types (value, label, sort_order) VALUES
  ('barbershop', 'Barbershop', 10),
  ('shoe_store', 'Shoe Store', 20),
  ('fashion_boutique', 'Fashion Boutique', 30),
  ('sports_store', 'Sports Store', 40),
  ('laundromat', 'Laundromat', 50),
  ('gym', 'Gym', 60),
  ('muslim_fashion', 'Muslim Fashion', 70),
  ('school_uniform', 'School Uniform', 80),
  ('pharmacy', 'Pharmacy', 90),
  ('optical', 'Optical', 100),
  ('cafe', 'Cafe', 110),
  ('other', 'Other', 999)
ON CONFLICT (value) DO NOTHING;

-- Drop the fixed CHECK constraint so new types can be saved on stores.store_type
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_store_type_check;

-- RLS: any authenticated user can read (so store-owners' filtered views work);
-- only admins can modify (enforced in API anyway).
ALTER TABLE public.store_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_types_read ON public.store_types;
CREATE POLICY store_types_read ON public.store_types FOR SELECT USING (true);
