-- Per-vehicle bearer tokens for third-party "webhook telemetry" senders — e.g.
-- AndyShaman/BYDMate's own Settings → "Webhook — telemetry" feature — which POST a
-- single flat JSON object with no vehicle id, no X-API-Key/X-Vehicle-Id headers, and
-- no batching. Independent of the paired-client credential in bydmate_devices.
create table if not exists public.bydmate_webhook_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  vehicle_id text not null,
  token_hash text not null,
  label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

comment on table public.bydmate_webhook_tokens is
  'Per-(user, vehicle) bearer tokens for external webhook telemetry senders (e.g. AndyShaman/BYDMate''s Webhook-telemetry setting). Service role only.';

create unique index if not exists bydmate_webhook_tokens_token_hae
  on public.bydmate_webhook_tokens (token_hash);

create index if not exists bydmate_webhook_tokens_user_vehicle_idx
  on public.bydmate_webhook_tokens (user_id, vehicle_id);

alter table public.bydmate_webhook_tokens enable row level security;
-- Service role only, matching public.bydmate_devices: every reader is an API route
-- using createServiceClient(). No policy is defined on purpose.
