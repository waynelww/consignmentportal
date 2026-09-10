-- Beat The Speed — treadmill challenge leaderboard (event tool).
-- Public display page at /speed, code-gated admin at /speed/admin.
-- Applied manually via the Supabase SQL editor (no CLI link for this project).

create table if not exists speed_entries (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null default '',
  gender text not null check (gender in ('M', 'F')),
  speed numeric(4, 1) not null check (speed > 0 and speed <= 35),
  created_at timestamptz not null default now()
);

-- All access goes through XCMS API routes using the service-role key;
-- RLS on with no policies = nothing readable via the anon key.
alter table speed_entries enable row level security;
