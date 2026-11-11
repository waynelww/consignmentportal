-- Store history: a record of actions taken on a store. First use: login resets
-- (POST /api/stores/[storeId]/reset-login). Append-only. Written by the service
-- role only; admins (super_admin, ops_manager) can read it. Never holds passwords.
--
-- NOT APPLIED. Review, then paste into the Supabase SQL editor (project
-- mhdyurnrmpjxsjbhbxrp) before the login reset history works.

CREATE TABLE IF NOT EXISTS public.store_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  action text NOT NULL CHECK (action IN ('login_reset')),
  team_member_id uuid NOT NULL REFERENCES public.xocks_team_members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Plain FK (no cascade): a store with history cannot be deleted silently.
CREATE INDEX IF NOT EXISTS store_history_store_created_idx
  ON public.store_history (store_id, created_at DESC);

ALTER TABLE public.store_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_history_admin_read ON public.store_history;
CREATE POLICY store_history_admin_read ON public.store_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'ops_manager')
    )
  );
-- No insert/update/delete policy: writes go through the service role only.

REVOKE ALL ON public.store_history FROM anon, authenticated;
GRANT SELECT ON public.store_history TO authenticated;

-- Append-only, for everyone including the service role.
CREATE OR REPLACE FUNCTION public.store_history_block_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'store_history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS store_history_no_change ON public.store_history;
CREATE TRIGGER store_history_no_change
  BEFORE UPDATE OR DELETE ON public.store_history
  FOR EACH ROW EXECUTE FUNCTION public.store_history_block_changes();
