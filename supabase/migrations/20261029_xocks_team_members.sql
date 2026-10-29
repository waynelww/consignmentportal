-- Xocks team: the people at Xocks who open stores.
-- The team shares one admin login, so "who opened this store" is recorded
-- explicitly on the store, never taken from the logged-in user.
-- Names are never deleted. "Hiding" a name sets active = false, so every
-- store that points at it keeps its "Opened by" name.

CREATE TABLE IF NOT EXISTS public.xocks_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Active names are unique (ignoring case and spaces at the ends).
-- Hidden names are not counted, so a name can be re-added after it was hidden.
CREATE UNIQUE INDEX IF NOT EXISTS uq_xocks_team_members_active_name
  ON public.xocks_team_members (lower(btrim(name)))
  WHERE active;

ALTER TABLE public.xocks_team_members ENABLE ROW LEVEL SECURITY;

-- Reads only, and admins only. All writes go through the admin API routes,
-- which check the caller's role and then write with the service role.
DROP POLICY IF EXISTS "xocks_team_members select" ON public.xocks_team_members;
CREATE POLICY "xocks_team_members select" ON public.xocks_team_members
  FOR SELECT USING (get_user_role() IN ('super_admin', 'ops_manager'));

-- Who opened each store. Nullable: stores created before this migration stay
-- blank, and admins can set or correct it when editing a store. The new-store
-- form requires it; that rule is enforced in the API, not by NOT NULL here.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS opened_by_member_id UUID REFERENCES public.xocks_team_members(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_stores_opened_by ON public.stores (opened_by_member_id);
