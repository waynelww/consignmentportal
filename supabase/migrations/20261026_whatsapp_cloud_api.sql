-- WhatsApp Cloud API — Phase 1 (contacts, message log, blasts).
-- Applied manually via the Supabase SQL editor (no CLI link for this project).
--
-- Design notes:
-- * wa_messages is the single log for BOTH directions. The Phase 2 AI
--   auto-replier reads a conversation by conversation_key (= normalized
--   phone) ordered by created_at — raw webhook payloads are kept in
--   `payload` so nothing is lost for it.
-- * All access goes through XCMS admin API routes with the service-role
--   key; RLS on with no policies = nothing readable via the anon key.

create table if not exists wa_blasts (
  id uuid default gen_random_uuid() primary key,
  template_name text not null,
  template_language text not null default 'en',
  -- Body params as entered in the UI ({store_name}/{pic_name} tokens kept
  -- verbatim here; the resolved per-recipient values live on wa_messages).
  params jsonb not null default '[]'::jsonb,
  -- Audience filter snapshot: { store_types: text[], states: text[] }.
  audience jsonb not null default '{}'::jsonb,
  status text not null default 'sending' check (status in ('sending', 'completed', 'cancelled')),
  total_recipients integer not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists wa_contacts (
  id uuid default gen_random_uuid() primary key,
  -- Normalized via lib/gang/phone.ts normalizePhone (digits, 60-prefixed) —
  -- exactly the format the Cloud API expects as "to".
  phone text unique not null,
  name text,
  store_id uuid references stores(id) on delete set null,
  source text not null default 'stores',
  -- Store contacts default to opted_in (existing consignment business
  -- relationship); inbound STOP/BERHENTI flips to opted_out and blasts
  -- always exclude opted_out.
  opt_in_status text not null default 'opted_in' check (opt_in_status in ('opted_in', 'opted_out', 'unknown')),
  opted_out_at timestamptz,
  -- Last inbound message — an open 24h customer-service window means free-
  -- form (non-template) replies are allowed. Phase 2 auto-replier gate.
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wa_messages (
  id uuid default gen_random_uuid() primary key,
  contact_id uuid references wa_contacts(id) on delete set null,
  phone text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  -- Meta's message id (wamid.…) — unique so webhook status retries are
  -- idempotent. Null while still queued.
  wa_message_id text unique,
  -- Thread key: one conversation per contact = the normalized phone.
  conversation_key text not null,
  message_type text,          -- template | text | image | ...
  template_name text,
  params jsonb,               -- resolved per-recipient template body params
  body text,                  -- inbound text / notes for outbound
  payload jsonb,              -- raw webhook payload (inbound) or error detail
  blast_id uuid references wa_blasts(id) on delete set null,
  status text not null default 'queued' check (status in (
    'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'received'
  )),
  error_code text,
  error_message text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wa_messages_conversation_idx on wa_messages (conversation_key, created_at);
create index if not exists wa_messages_blast_idx on wa_messages (blast_id, status);
create index if not exists wa_messages_direction_idx on wa_messages (direction, created_at);
create index if not exists wa_contacts_store_idx on wa_contacts (store_id);

alter table wa_blasts enable row level security;
alter table wa_contacts enable row level security;
alter table wa_messages enable row level security;

-- Per-blast status rollup, read by the admin blast list. Views don't carry
-- RLS, so revoke the default public-schema grants from the client roles.
create or replace view wa_blast_stats as
select blast_id, status, count(*)::integer as n
from wa_messages
where blast_id is not null
group by blast_id, status;

revoke all on wa_blast_stats from anon, authenticated;
