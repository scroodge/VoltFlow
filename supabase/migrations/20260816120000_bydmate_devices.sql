-- Per-device pairing credentials for BYD Mate and the VoltFlow Dashboard.
--
-- Until now a profile held exactly one `bydmate_cloud_api_key_hash`, and every redeem
-- overwrote it (see `redeemBydmateLinkCode`). Mate and the Dashboard both authenticate
-- against that single column, so pairing one revoked the other: the last client to
-- redeem a code won, and silently evicted its sibling. Credentials now live per device.
--
-- Deliberately absent: a `last_seen_at` column. Authentication is the ~6 s command-poll
-- hot path, and stamping a timestamp there would turn every poll into a write.

create table if not exists public.bydmate_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('mate', 'dashboard')),
  api_key_hash text not null,
  api_key_fingerprint text,
  created_at timestamptz not null default now()
);

comment on table public.bydmate_devices is
  'One row per paired client. Mate and the Dashboard hold independent credentials so pairing one never revokes the other.';

-- The authentication lookup is `where api_key_hash = $1`; this index is what keeps it
-- a single indexed read.
create unique index if not exists bydmate_devices_api_key_hash_unique
  on public.bydmate_devices (api_key_hash);

create index if not exists bydmate_devices_user_id_idx
  on public.bydmate_devices (user_id);

-- One credential per client type per account: re-pairing Mate replaces Mate's own row
-- (the revoke the user intends) without touching the Dashboard's.
create unique index if not exists bydmate_devices_user_kind_unique
  on public.bydmate_devices (user_id, kind);

-- Carry every currently paired car across. Its kind is 'mate': the Dashboard has never
-- had a credential slot of its own, so nothing else can be in that column.
insert into public.bydmate_devices (user_id, kind, api_key_hash, api_key_fingerprint)
select id, 'mate', bydmate_cloud_api_key_hash, bydmate_cloud_api_key_fingerprint
from public.profiles
where bydmate_cloud_api_key_hash is not null
on conflict do nothing;

alter table public.bydmate_devices enable row level security;

-- Service role only, matching public.bydmate_link_codes: every reader is an API route
-- using createServiceClient(). No policy is defined on purpose.
