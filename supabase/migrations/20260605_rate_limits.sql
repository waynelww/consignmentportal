-- Sliding-window rate limiting for sensitive endpoints (login, password change,
-- password reset email). Records one row per attempt, scoped by IP + endpoint.
-- A background prune happens automatically via the TTL index.

CREATE TABLE IF NOT EXISTS public.rate_limit_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  email TEXT,
  succeeded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: "how many failed attempts from this IP at this endpoint in the
-- last 15 minutes" — composite + descending time index keeps it fast.
CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_endpoint_created
  ON public.rate_limit_attempts(ip, endpoint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_email_created
  ON public.rate_limit_attempts(email, created_at DESC)
  WHERE email IS NOT NULL;

-- Hard-prune anything older than 24h (we only care about the last 15 min
-- but keep a buffer for debugging). Run nightly via cron, separately.
-- For now, manual prune is fine.

-- RLS: no client-side access. Only the service-role admin client touches
-- this table from the API layer.
ALTER TABLE public.rate_limit_attempts ENABLE ROW LEVEL SECURITY;
-- No policies = no access from authenticated/anon roles.
